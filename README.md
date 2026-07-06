# AI Smart Inbox

A next-generation intelligent email client powered by Gemini and the Gmail API. It automatically organizes your incoming emails, summarizes long threads, cleans up unwanted newsletters, and offers a smart conversational assistant.

## Features

- **Unified Smart Inbox:** Automatically categorizes your emails into human-readable buckets (Newsletters, Updates, Important, etc.).
- **Smart Cleanup:** Identifies subscriptions and marketing spam, and allows you to bulk-trash them with one click.
- **Instant Summaries:** Uses Gemini to summarize long emails directly from the inbox list view.
- **Smart Assistant Sidebar:** A unified AI chat sidebar powered by Gemini. You can:
  - Discuss general questions.
  - Ask it to search the web or Maps.
  - Interact using real-time Voice through the **Live API**.
- **Compose & Send:** Easily compose and send emails directly from the dashboard.
- **No Manual ENV configuration needed for Firebase:** Setup can be done cleanly through the Firebase Applet setup UI if running via AI Studio. You can also override the Gemini API Key directly in the app Settings if running locally.

## Setup & Running

This project is built with React, Vite, Express, and Tailwind CSS. It uses a single full-stack architecture.

### 1. Install Dependencies
\`\`\`bash
npm install
\`\`\`

### 2. Configure Firebase
Ensure your Firebase configuration (`firebase-applet-config.json`) is present. This is automatically handled if you provisioned Firebase in AI Studio.

### 3. Start Development Server
\`\`\`bash
npm run dev
\`\`\`
This will launch the app using `tsx` and hot-reloading for the server.

### 4. Build for Production
To build the app for production (which bundles the React SPA and the Express backend):
\`\`\`bash
npm run build
\`\`\`

### 5. Start Production Server
\`\`\`bash
npm run start
\`\`\`

## Configuration

- **Gemini API Key:** By default, it runs using the `GEMINI_API_KEY` environment variable. However, you can inject your own API key directly through the **Settings** menu inside the app without needing to modify `.env`.
- **Firebase Auth:** It uses standard Firebase Authentication with Google Sign-In, requesting read, modify, and send permissions for Gmail.

## Tech Stack
- Frontend: React 19, Tailwind CSS v4, Lucide React
- Backend: Express, Google APIs (Gmail), @google/genai SDK
- Build Tooling: Vite, ESBuild, TypeScript
