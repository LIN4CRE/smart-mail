<div align="center">
  <img src="public/icon.svg" width="120" alt="Smart Email Logo" />
  <h1>Smart Email Client</h1>
  <p>A modern, clean, unified inbox experience powered by AI (Google Gemini).</p>
  
  <p>
    <a href="https://ais-pre-z2zimnfxd3dutjguwxbocf-183479119885.europe-west2.run.app"><strong>🚀 View Live Demo</strong></a>
  </p>

  <p>
    <a href="https://github.com/your-username/smart-email/actions"><img src="https://github.com/your-username/smart-email/workflows/CI/badge.svg" alt="Build Status"></a>
    <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
    <img src="https://img.shields.io/github/v/release/your-username/smart-email" alt="Release">
  </p>
</div>

## 🌟 Features

- **Unified Multi-Account View**: Sync and view emails from multiple Google accounts simultaneously in a single interface.
- **Smart AI Categorization**: Automatically categorizes your emails (Important, Newsletters, Social, etc.) so you can focus on what matters.
- **Importance Detection**: AI detects the importance of emails and highlights the subjects with appropriate colors to save space and reduce clutter.
- **Smart Actions**: Generate AI-powered summaries, extract action items, and draft smart replies instantly.
- **Bulk Cleanup**: Easily detect and unsubscribe from newsletters or clear out unwanted emails in bulk.
- **Progressive Web App (PWA)**: Installable on mobile and desktop devices with true offline support and auto-updates.

## 🚀 Live Demo

**[Experience the live application here](https://ais-pre-z2zimnfxd3dutjguwxbocf-183479119885.europe-west2.run.app)**

## 🛠️ Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, Lucide React
- **Backend**: Express.js (Node), Google Auth Library, Google APIs (Gmail)
- **AI**: `@google/genai` (Gemini Models)
- **PWA**: `vite-plugin-pwa`

## 📦 Getting Started

### Prerequisites

- Node.js >= 18.0.0
- A Google Cloud Project with the Gmail API enabled.
- Gemini API Key

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/smart-email.git
   cd smart-email
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file based on `.env.example` and fill in your credentials.

4. Start the development server:
   ```bash
   npm run dev
   ```

## 🤝 Contributing

Contributions are welcome! Please check out the [Contributing Guidelines](CONTRIBUTING.md) for more details.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
