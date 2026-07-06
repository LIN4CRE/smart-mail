import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { google } from "googleapis";
import { GoogleGenAI, Type, LiveServerMessage, Modality } from "@google/genai";
import { WebSocketServer } from "ws";
import http from "http";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" }));

  const getAi = (req: express.Request) => {
    const key = req.headers["x-gemini-api-key"] as string || process.env.GEMINI_API_KEY;
    if (!key) throw new Error("Gemini API key is required. Please set it in Settings.");
    return new GoogleGenAI({ apiKey: key });
  };

  // Define API routes
  app.post("/api/emails/organize", async (req, res) => {
    try {
      const ai = getAi(req);
      const { accessToken } = req.body;
      if (!accessToken) {
        return res.status(401).json({ error: "No access token provided" });
      }

      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: accessToken });

      const gmail = google.gmail({ version: "v1", auth: oauth2Client });
      
      const response = await gmail.users.messages.list({
        userId: "me",
        maxResults: 20,
        q: "in:inbox"
      });

      const messages = response.data.messages || [];
      const emailDetails = await Promise.all(messages.map(async (msg) => {
        const msgDetails = await gmail.users.messages.get({
          userId: "me",
          id: msg.id!,
          format: "metadata",
          metadataHeaders: ["Subject", "From", "Date", "List-Unsubscribe"]
        });
        
        const headers = msgDetails.data.payload?.headers || [];
        const subject = headers.find((h) => h.name === "Subject")?.value || "No Subject";
        const sender = headers.find((h) => h.name === "From")?.value || "Unknown Sender";
        const date = headers.find((h) => h.name === "Date")?.value || "";
        const unsubscribe = headers.find((h) => h.name?.toLowerCase() === "list-unsubscribe")?.value || "";
        
        return {
          id: msg.id,
          snippet: msgDetails.data.snippet,
          subject,
          sender,
          date,
          unsubscribeLink: unsubscribe,
          isRead: !msgDetails.data.labelIds?.includes('UNREAD')
        };
      }));

      if (emailDetails.length === 0) {
        return res.json({ categories: [] });
      }

      const prompt = `
        Analyze these emails and organize them into smart categories (e.g., 'Newsletters', 'Important', 'Updates', 'Social', 'Promotions', 'To Unsubscribe').
        Emails:
        ${JSON.stringify(emailDetails)}
      `;

      const genResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              categories: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    description: { type: Type.STRING },
                    emails: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          id: { type: Type.STRING },
                          subject: { type: Type.STRING },
                          sender: { type: Type.STRING },
                          snippet: { type: Type.STRING },
                          date: { type: Type.STRING },
                          unsubscribeLink: { type: Type.STRING, nullable: true },
                          recommendUnsubscribe: { type: Type.BOOLEAN, description: "True if this is likely spam or unwanted newsletter" },
                          importance: { type: Type.STRING, description: "'high', 'medium', or 'low' based on urgency and relevance" },
                          isRead: { type: Type.BOOLEAN }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      });

      const structuredResult = JSON.parse(genResponse.text || "{}");
      res.json(structuredResult);
    } catch (error: any) {
      console.error("Error organizing emails:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/emails/bulk-action", async (req, res) => {
    try {
      const { accessToken, messageIds, action } = req.body;
      if (!accessToken || !messageIds || !Array.isArray(messageIds) || !action) {
        return res.status(400).json({ error: "Missing required parameters" });
      }

      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: accessToken });
      const gmail = google.gmail({ version: "v1", auth: oauth2Client });

      if (action === "trash") {
        await gmail.users.messages.batchModify({
          userId: "me",
          requestBody: {
            ids: messageIds,
            addLabelIds: ["TRASH"],
            removeLabelIds: ["INBOX"]
          }
        });
      } else if (action === "mark-read") {
        await gmail.users.messages.batchModify({
          userId: "me",
          requestBody: {
            ids: messageIds,
            removeLabelIds: ["UNREAD"]
          }
        });
      } else if (action === "mark-unread") {
        await gmail.users.messages.batchModify({
          userId: "me",
          requestBody: {
            ids: messageIds,
            addLabelIds: ["UNREAD"]
          }
        });
      } else {
        return res.status(400).json({ error: "Invalid action" });
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error bulk modifying emails:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/emails/unsubscribe", async (req, res) => {
    try {
      const { accessToken, links, messageIds } = req.body;
      if (!accessToken || !links || !Array.isArray(links)) {
        return res.status(400).json({ error: "Missing required parameters" });
      }

      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: accessToken });
      const gmail = google.gmail({ version: "v1", auth: oauth2Client });

      let successCount = 0;
      
      for (const header of links) {
        if (!header) continue;
        const matches = header.match(/<([^>]+)>/g);
        if (!matches) continue;
        
        let unsubscribed = false;

        // Try http first
        for (const match of matches) {
          const link = match.slice(1, -1);
          if (link.startsWith('http') && !unsubscribed) {
             try {
               await fetch(link, { method: 'POST' }).catch(() => fetch(link));
               unsubscribed = true;
             } catch(e) {
               console.error("HTTP unsubscribe failed", e);
             }
          }
        }
        
        if (!unsubscribed) {
          for (const match of matches) {
            const link = match.slice(1, -1);
            if (link.startsWith('mailto:')) {
               try {
                  const url = new URL(link);
                  const to = url.pathname;
                  const subject = url.searchParams.get('subject') || 'Unsubscribe';
                  const body = url.searchParams.get('body') || 'Please unsubscribe me.';
                  
                  const messageParts = [
                    `To: ${to}`,
                    'Content-Type: text/plain; charset=utf-8',
                    'MIME-Version: 1.0',
                    `Subject: ${subject}`,
                    '',
                    body
                  ];
                  
                  const encodedMessage = Buffer.from(messageParts.join('\n'))
                    .toString('base64')
                    .replace(/\+/g, '-')
                    .replace(/\//g, '_')
                    .replace(/=+$/, '');
                    
                  await gmail.users.messages.send({
                    userId: 'me',
                    requestBody: { raw: encodedMessage }
                  });
                  unsubscribed = true;
                  break;
               } catch(e) {
                 console.error("Mailto unsubscribe failed", e);
               }
            }
          }
        }
        
        if (unsubscribed) successCount++;
      }

      // Optionally trash the messages after unsubscribing
      if (messageIds && messageIds.length > 0) {
        await gmail.users.messages.batchModify({
          userId: "me",
          requestBody: {
            ids: messageIds,
            addLabelIds: ["TRASH"],
            removeLabelIds: ["INBOX"]
          }
        }).catch(e => console.error("Failed to trash after unsubscribe", e));
      }

      res.json({ success: true, count: successCount });
    } catch (error: any) {
      console.error("Error unsubscribing:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/emails/trash", async (req, res) => {
    try {
      const { accessToken, messageId } = req.body;
      if (!accessToken || !messageId) {
        return res.status(400).json({ error: "Missing required parameters" });
      }

      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: accessToken });
      const gmail = google.gmail({ version: "v1", auth: oauth2Client });

      await gmail.users.messages.trash({ userId: "me", id: messageId });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error trashing email:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/emails/summarize", async (req, res) => {
    try {
      const ai = getAi(req);
      const { accessToken, messageId } = req.body;
      if (!accessToken || !messageId) {
        return res.status(400).json({ error: "Missing required parameters" });
      }

      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: accessToken });
      const gmail = google.gmail({ version: "v1", auth: oauth2Client });

      const msgDetails = await gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "full",
      });

      let bodyText = msgDetails.data.snippet || "";
      if (msgDetails.data.payload?.parts) {
        const textPart = msgDetails.data.payload.parts.find(p => p.mimeType === "text/plain");
        if (textPart && textPart.body?.data) {
          bodyText = Buffer.from(textPart.body.data, "base64").toString("utf-8");
        }
      } else if (msgDetails.data.payload?.body?.data) {
        bodyText = Buffer.from(msgDetails.data.payload.body.data, "base64").toString("utf-8");
      }

      const prompt = `Summarize the following email in 1-2 short sentences:\\n\\n${bodyText}`;
      const genResponse = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt
      });

      res.json({ summary: genResponse.text });
    } catch (error: any) {
      console.error("Error summarizing email:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/emails/smart-action", async (req, res) => {
    try {
      const ai = getAi(req);
      const { accessToken, messageId, actionType } = req.body;
      if (!accessToken || !messageId || !actionType) {
        return res.status(400).json({ error: "Missing required parameters" });
      }

      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: accessToken });
      const gmail = google.gmail({ version: "v1", auth: oauth2Client });

      const msgDetails = await gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "full",
      });

      let bodyText = msgDetails.data.snippet || "";
      if (msgDetails.data.payload?.parts) {
        const textPart = msgDetails.data.payload.parts.find(p => p.mimeType === "text/plain");
        if (textPart && textPart.body?.data) {
          bodyText = Buffer.from(textPart.body.data, "base64").toString("utf-8");
        }
      } else if (msgDetails.data.payload?.body?.data) {
        bodyText = Buffer.from(msgDetails.data.payload.body.data, "base64").toString("utf-8");
      }

      let prompt = "";
      if (actionType === "smart-reply") {
        prompt = `Draft a professional, concise reply to the following email:\n\n${bodyText}`;
      } else if (actionType === "extract-tasks") {
        prompt = `Extract a clear bulleted list of action items or tasks from the following email. If there are none, say "No action items found."\n\n${bodyText}`;
      } else if (actionType === "priority") {
        prompt = `Analyze the priority (High/Medium/Low) of this email and briefly explain why:\n\n${bodyText}`;
      } else if (actionType === "sentiment") {
        prompt = `Analyze the tone and sentiment (e.g., positive, frustrated, urgent, formal) of this email:\n\n${bodyText}`;
      } else if (actionType === "translate") {
        prompt = `Translate the following email to English (if it's already in English, just return "Already in English"):\n\n${bodyText}`;
      } else {
        return res.status(400).json({ error: "Invalid action type" });
      }

      const genResponse = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt
      });

      res.json({ result: genResponse.text });
    } catch (error: any) {
      console.error("Error in smart action:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/emails/send", async (req, res) => {
    try {
      const { accessToken, to, subject, body } = req.body;
      if (!accessToken || !to || !subject || !body) {
        return res.status(400).json({ error: "Missing required parameters" });
      }

      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: accessToken });
      const gmail = google.gmail({ version: "v1", auth: oauth2Client });

      const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
      const messageParts = [
        `To: ${to}`,
        'Content-Type: text/html; charset=utf-8',
        'MIME-Version: 1.0',
        `Subject: ${utf8Subject}`,
        '',
        body
      ];
      const message = messageParts.join('\n');
      
      const encodedMessage = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage
        }
      });
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error sending email:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const ai = getAi(req);
      const { prompt, mode, history, image, audio } = req.body;
      
      let model = "gemini-3.5-flash";
      let tools: any[] = [];
      let generation_config: any = {};
      
      if (mode === "thinking") {
        model = "gemini-3.1-pro-preview";
        generation_config.thinking_level = "high";
      } else if (mode === "fast") {
        model = "gemini-3.1-flash-lite";
      } else if (mode === "search") {
        tools = [{ type: 'google_search' }];
      } else if (mode === "maps") {
        tools = [{ type: 'google_maps' }];
      } else if (image) {
        model = "gemini-3.1-pro-preview";
      } else if (audio) {
        model = "gemini-3.5-flash";
      }

      let inputData: any = prompt;
      
      if (image) {
        inputData = [
          { type: "image", data: image.data, mime_type: image.mimeType },
          { type: "text", text: prompt || "Describe this image" }
        ];
      } else if (audio) {
        inputData = [
          { type: "audio", data: audio.data, mime_type: audio.mimeType },
          { type: "text", text: prompt || "Transcribe and analyze this audio" }
        ];
      }

      const params: any = {
        model,
        input: inputData,
      };

      if (tools.length > 0) params.tools = tools;
      if (Object.keys(generation_config).length > 0) params.generation_config = generation_config;
      
      // We don't have previous_interaction_id preserved on client easily in this quick setup, so we just use interactions.create
      const interaction = await ai.interactions.create(params);
      
      let textResponse = "";
      for (const step of interaction.steps) {
        if (step.type === 'model_output') {
          const textContent = step.content?.find(c => c.type === 'text');
          if (textContent && textContent.text) {
            textResponse += textContent.text;
          }
        }
      }

      res.json({ text: textResponse });
    } catch (error: any) {
      console.error("Error in chat:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/live' });

  wss.on("connection", async (clientWs, req) => {
    try {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      const key = url.searchParams.get("apiKey") || process.env.GEMINI_API_KEY;
      if (!key) throw new Error("Gemini API key is required.");
      const wsAi = new GoogleGenAI({ apiKey: key });

      const session = await wsAi.live.connect({
        model: "gemini-3.1-flash-live-preview",
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            const audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audio) clientWs.send(JSON.stringify({ audio }));
            if (message.serverContent?.interrupted)
              clientWs.send(JSON.stringify({ interrupted: true }));
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction: "You are a smart email assistant.",
        },
      });

      clientWs.on("message", (data) => {
        try {
          const { audio } = JSON.parse(data.toString());
          if (audio) {
            session.sendRealtimeInput({
              audio: { data: audio, mimeType: "audio/pcm;rate=16000" },
            });
          }
        } catch (e) {
          console.error("WS msg parse err", e);
        }
      });
      
      clientWs.on("close", () => {
        session.close();
      });
    } catch (error) {
      console.error("Live API connection failed:", error);
    }
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
