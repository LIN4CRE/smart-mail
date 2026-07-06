var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_vite = require("vite");
var import_googleapis = require("googleapis");
var import_genai = require("@google/genai");
var import_ws = require("ws");
var import_http = __toESM(require("http"), 1);
var ai = new import_genai.GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function startServer() {
  const app = (0, import_express.default)();
  const PORT = 3e3;
  app.use(import_express.default.json({ limit: "50mb" }));
  const getAi = (req) => {
    const key = req.headers["x-gemini-api-key"] || process.env.GEMINI_API_KEY;
    if (!key) throw new Error("Gemini API key is required. Please set it in Settings.");
    return new import_genai.GoogleGenAI({ apiKey: key });
  };
  app.post("/api/emails/organize", async (req, res) => {
    try {
      const ai2 = getAi(req);
      const { accessToken } = req.body;
      if (!accessToken) {
        return res.status(401).json({ error: "No access token provided" });
      }
      const oauth2Client = new import_googleapis.google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: accessToken });
      const gmail = import_googleapis.google.gmail({ version: "v1", auth: oauth2Client });
      const response = await gmail.users.messages.list({
        userId: "me",
        maxResults: 20,
        q: "in:inbox"
      });
      const messages = response.data.messages || [];
      const emailDetails = await Promise.all(messages.map(async (msg) => {
        const msgDetails = await gmail.users.messages.get({
          userId: "me",
          id: msg.id,
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
          isRead: !msgDetails.data.labelIds?.includes("UNREAD")
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
      const genResponse = await ai2.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: import_genai.Type.OBJECT,
            properties: {
              categories: {
                type: import_genai.Type.ARRAY,
                items: {
                  type: import_genai.Type.OBJECT,
                  properties: {
                    name: { type: import_genai.Type.STRING },
                    description: { type: import_genai.Type.STRING },
                    emails: {
                      type: import_genai.Type.ARRAY,
                      items: {
                        type: import_genai.Type.OBJECT,
                        properties: {
                          id: { type: import_genai.Type.STRING },
                          subject: { type: import_genai.Type.STRING },
                          sender: { type: import_genai.Type.STRING },
                          snippet: { type: import_genai.Type.STRING },
                          date: { type: import_genai.Type.STRING },
                          unsubscribeLink: { type: import_genai.Type.STRING, nullable: true },
                          recommendUnsubscribe: { type: import_genai.Type.BOOLEAN, description: "True if this is likely spam or unwanted newsletter" },
                          importance: { type: import_genai.Type.STRING, description: "'high', 'medium', or 'low' based on urgency and relevance" },
                          isRead: { type: import_genai.Type.BOOLEAN }
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
    } catch (error) {
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
      const oauth2Client = new import_googleapis.google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: accessToken });
      const gmail = import_googleapis.google.gmail({ version: "v1", auth: oauth2Client });
      await gmail.users.messages.trash({ userId: "me", id: messageId });
      res.json({ success: true });
    } catch (error) {
      console.error("Error trashing email:", error);
      res.status(500).json({ error: error.message });
    }
  });
  app.post("/api/emails/summarize", async (req, res) => {
    try {
      const ai2 = getAi(req);
      const { accessToken, messageId } = req.body;
      if (!accessToken || !messageId) {
        return res.status(400).json({ error: "Missing required parameters" });
      }
      const oauth2Client = new import_googleapis.google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: accessToken });
      const gmail = import_googleapis.google.gmail({ version: "v1", auth: oauth2Client });
      const msgDetails = await gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "full"
      });
      let bodyText = msgDetails.data.snippet || "";
      if (msgDetails.data.payload?.parts) {
        const textPart = msgDetails.data.payload.parts.find((p) => p.mimeType === "text/plain");
        if (textPart && textPart.body?.data) {
          bodyText = Buffer.from(textPart.body.data, "base64").toString("utf-8");
        }
      } else if (msgDetails.data.payload?.body?.data) {
        bodyText = Buffer.from(msgDetails.data.payload.body.data, "base64").toString("utf-8");
      }
      const prompt = `Summarize the following email in 1-2 short sentences:\\n\\n${bodyText}`;
      const genResponse = await ai2.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt
      });
      res.json({ summary: genResponse.text });
    } catch (error) {
      console.error("Error summarizing email:", error);
      res.status(500).json({ error: error.message });
    }
  });
  app.post("/api/emails/send", async (req, res) => {
    try {
      const { accessToken, to, subject, body } = req.body;
      if (!accessToken || !to || !subject || !body) {
        return res.status(400).json({ error: "Missing required parameters" });
      }
      const oauth2Client = new import_googleapis.google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: accessToken });
      const gmail = import_googleapis.google.gmail({ version: "v1", auth: oauth2Client });
      const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString("base64")}?=`;
      const messageParts = [
        `To: ${to}`,
        "Content-Type: text/html; charset=utf-8",
        "MIME-Version: 1.0",
        `Subject: ${utf8Subject}`,
        "",
        body
      ];
      const message = messageParts.join("\n");
      const encodedMessage = Buffer.from(message).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      await gmail.users.messages.send({
        userId: "me",
        requestBody: {
          raw: encodedMessage
        }
      });
      res.json({ success: true });
    } catch (error) {
      console.error("Error sending email:", error);
      res.status(500).json({ error: error.message });
    }
  });
  app.post("/api/chat", async (req, res) => {
    try {
      const ai2 = getAi(req);
      const { prompt, mode, history, image, audio } = req.body;
      let model = "gemini-3.5-flash";
      let tools = [];
      let generation_config = {};
      if (mode === "thinking") {
        model = "gemini-3.1-pro-preview";
        generation_config.thinking_level = "high";
      } else if (mode === "fast") {
        model = "gemini-3.1-flash-lite";
      } else if (mode === "search") {
        tools = [{ type: "google_search" }];
      } else if (mode === "maps") {
        tools = [{ type: "google_maps" }];
      } else if (image) {
        model = "gemini-3.1-pro-preview";
      } else if (audio) {
        model = "gemini-3.5-flash";
      }
      let inputData = prompt;
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
      const params = {
        model,
        input: inputData
      };
      if (tools.length > 0) params.tools = tools;
      if (Object.keys(generation_config).length > 0) params.generation_config = generation_config;
      const interaction = await ai2.interactions.create(params);
      let textResponse = "";
      for (const step of interaction.steps) {
        if (step.type === "model_output") {
          const textContent = step.content?.find((c) => c.type === "text");
          if (textContent && textContent.text) {
            textResponse += textContent.text;
          }
        }
      }
      res.json({ text: textResponse });
    } catch (error) {
      console.error("Error in chat:", error);
      res.status(500).json({ error: error.message });
    }
  });
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  const server = import_http.default.createServer(app);
  const wss = new import_ws.WebSocketServer({ server, path: "/live" });
  wss.on("connection", async (clientWs, req) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const key = url.searchParams.get("apiKey") || process.env.GEMINI_API_KEY;
      if (!key) throw new Error("Gemini API key is required.");
      const wsAi = new import_genai.GoogleGenAI({ apiKey: key });
      const session = await wsAi.live.connect({
        model: "gemini-3.1-flash-live-preview",
        callbacks: {
          onmessage: (message) => {
            const audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audio) clientWs.send(JSON.stringify({ audio }));
            if (message.serverContent?.interrupted)
              clientWs.send(JSON.stringify({ interrupted: true }));
          }
        },
        config: {
          responseModalities: [import_genai.Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } }
          },
          systemInstruction: "You are a smart email assistant."
        }
      });
      clientWs.on("message", (data) => {
        try {
          const { audio } = JSON.parse(data.toString());
          if (audio) {
            session.sendRealtimeInput({
              audio: { data: audio, mimeType: "audio/pcm;rate=16000" }
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
//# sourceMappingURL=server.cjs.map
