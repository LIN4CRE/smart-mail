import express from "express";
import { google } from "googleapis";
import { GoogleGenAI, Type, LiveServerMessage, Modality } from "@google/genai";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { WebSocketServer } from "ws";
import http from "http";

function getAi(apiKey?: string) {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Gemini API key is required. Please set it in Settings.");
  return new GoogleGenAI({ apiKey: key });
}

function getGmail(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.gmail({ version: "v1", auth });
}

async function getEmailBody(msgDetails: any): Promise<string> {
  let bodyText = msgDetails.data.snippet || "";
  if (msgDetails.data.payload?.parts) {
    const textPart = msgDetails.data.payload.parts.find((p: any) => p.mimeType === "text/plain");
    if (textPart?.body?.data) {
      bodyText = Buffer.from(textPart.body.data, "base64").toString("utf-8");
    }
  } else if (msgDetails.data.payload?.body?.data) {
    bodyText = Buffer.from(msgDetails.data.payload.body.data, "base64").toString("utf-8");
  }
  return bodyText;
}

export function setupRoutes(app: express.Application, server?: http.Server) {
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(express.json({ limit: "10mb" }));

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later." },
  });
  app.use("/api", apiLimiter);

  app.post("/api/emails/organize", async (req, res) => {
    try {
      const key = req.headers["x-gemini-api-key"] as string;
      const ai = getAi(key);
      const { accessToken } = req.body;
      if (!accessToken) {
        return res.status(401).json({ error: "No access token provided" });
      }

      const gmail = getGmail(accessToken);

      const response = await gmail.users.messages.list({
        userId: "me",
        maxResults: 20,
        q: "in:inbox",
      });

      const messages = response.data.messages || [];
      const emailDetails = await Promise.all(
        messages.map(async (msg) => {
          const msgDetails = await gmail.users.messages.get({
            userId: "me",
            id: msg.id!,
            format: "metadata",
            metadataHeaders: ["Subject", "From", "Date", "List-Unsubscribe"],
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
            isRead: !msgDetails.data.labelIds?.includes("UNREAD"),
          };
        })
      );

      if (emailDetails.length === 0) {
        return res.json({ categories: [] });
      }

      const prompt = `Analyze these emails and organize them into smart categories (e.g., 'Newsletters', 'Important', 'Updates', 'Social', 'Promotions', 'To Unsubscribe').
Emails:
${JSON.stringify(emailDetails)}`;

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
                          isRead: { type: Type.BOOLEAN },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      const structuredResult = JSON.parse(genResponse.text || "{}");
      res.json(structuredResult);
    } catch (error: any) {
      console.error("Error organizing emails:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/emails/trash", async (req, res) => {
    try {
      const { accessToken, messageId } = req.body;
      if (!accessToken || !messageId) {
        return res.status(400).json({ error: "Missing required parameters" });
      }

      const gmail = getGmail(accessToken);
      await gmail.users.messages.trash({ userId: "me", id: messageId });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error trashing email:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/emails/summarize", async (req, res) => {
    try {
      const key = req.headers["x-gemini-api-key"] as string;
      const ai = getAi(key);
      const { accessToken, messageId } = req.body;
      if (!accessToken || !messageId) {
        return res.status(400).json({ error: "Missing required parameters" });
      }

      const gmail = getGmail(accessToken);
      const msgDetails = await gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "full",
      });

      const bodyText = await getEmailBody(msgDetails);
      const prompt = `Summarize the following email in 1-2 short sentences:\n\n${bodyText}`;
      const genResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
      });

      res.json({ summary: genResponse.text });
    } catch (error: any) {
      console.error("Error summarizing email:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/emails/smart-action", async (req, res) => {
    try {
      const key = req.headers["x-gemini-api-key"] as string;
      const ai = getAi(key);
      const { accessToken, messageId, actionType } = req.body;
      if (!accessToken || !messageId || !actionType) {
        return res.status(400).json({ error: "Missing required parameters" });
      }

      const gmail = getGmail(accessToken);
      const msgDetails = await gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "full",
      });

      const bodyText = await getEmailBody(msgDetails);

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
        model: "gemini-2.5-flash",
        contents: prompt,
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

      const gmail = getGmail(accessToken);

      const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString("base64")}?=`;
      const messageParts = [
        `To: ${to}`,
        "Content-Type: text/html; charset=utf-8",
        "MIME-Version: 1.0",
        `Subject: ${utf8Subject}`,
        "",
        body,
      ];
      const message = messageParts.join("\n");

      const encodedMessage = Buffer.from(message)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      await gmail.users.messages.send({
        userId: "me",
        requestBody: { raw: encodedMessage },
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error sending email:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const key = req.headers["x-gemini-api-key"] as string;
      const ai = getAi(key);
      const { prompt, mode, image, audio } = req.body;

      let model = "gemini-2.5-flash";
      let tools: any[] = [];
      const generationConfig: any = {};

      if (mode === "thinking") {
        model = "gemini-2.5-pro";
        generationConfig.thinking_config = { type: "ENABLED" };
      } else if (mode === "fast") {
        model = "gemini-2.0-flash-lite";
      } else if (mode === "search") {
        tools = [{ googleSearch: {} }];
      } else if (mode === "maps") {
        tools = [{ googleMaps: {} }];
      } else if (image || audio) {
        model = "gemini-2.5-flash";
      }

      let inputData: any = prompt;

      if (image) {
        inputData = [
          { type: "image", data: image.data, mime_type: image.mimeType },
          { type: "text", text: prompt || "Describe this image" },
        ];
      } else if (audio) {
        inputData = [
          { type: "audio", data: audio.data, mime_type: audio.mimeType },
          { type: "text", text: prompt || "Transcribe and analyze this audio" },
        ];
      }

      const params: any = { model, contents: inputData };
      if (tools.length > 0) params.tools = tools;
      if (Object.keys(generationConfig).length > 0) params.generationConfig = generationConfig;

      const genResponse = await ai.models.generateContent(params);
      res.json({ text: genResponse.text });
    } catch (error: any) {
      console.error("Error in chat:", error);
      res.status(500).json({ error: error.message });
    }
  });

  if (server) {
    const wss = new WebSocketServer({ server, path: "/live" });

    wss.on("connection", async (clientWs, req) => {
      try {
        let wsApiKey = process.env.GEMINI_API_KEY;

        clientWs.on("message", async (data) => {
          try {
            const parsed = JSON.parse(data.toString());

            if (parsed.apiKey) {
              wsApiKey = parsed.apiKey;
              return;
            }

            if (!wsApiKey) {
              clientWs.send(JSON.stringify({ error: "Gemini API key is required." }));
              return;
            }

            const wsAi = new GoogleGenAI({ apiKey: wsApiKey });
            const session = await wsAi.live.connect({
              model: "gemini-2.0-flash-live-preview",
              callbacks: {
                onmessage: (message: LiveServerMessage) => {
                  const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                  if (audio) clientWs.send(JSON.stringify({ audio }));
                  if (message.serverContent?.interrupted) {
                    clientWs.send(JSON.stringify({ interrupted: true }));
                  }
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

            const audioData = parsed.audio;
            if (audioData) {
              session.sendRealtimeInput({
                audio: { data: audioData, mimeType: "audio/pcm;rate=16000" },
              });
            }

            clientWs.on("close", () => {
              session.close();
            });
          } catch (e) {
            console.error("WS msg parse err", e);
          }
        });
      } catch (error) {
        console.error("Live API connection failed:", error);
      }
    });
  }
}
