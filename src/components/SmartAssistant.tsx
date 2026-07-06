import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, Image as ImageIcon, Mic, X, Send, Search, MapPin, Brain, Zap, Phone, PhoneOff, Loader2 } from 'lucide-react';

type Mode = 'general' | 'search' | 'maps' | 'thinking' | 'fast' | 'live';

export default function SmartAssistant({ isOpen, onClose, geminiApiKey }: { isOpen: boolean, onClose: () => void, geminiApiKey: string }) {
  const [messages, setMessages] = useState<{role: 'user' | 'assistant', text: string, type?: string}[]>([]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<Mode>('general');
  const [isLoading, setIsLoading] = useState(false);
  const [imageFile, setImageFile] = useState<{data: string, mimeType: string} | null>(null);
  
  // Live API States
  const [isLiveActive, setIsLiveActive] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const pcmToBase64 = (float32Array: Float32Array) => {
    let pcm16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      let s = Math.max(-1, Math.min(1, float32Array[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    const buffer = pcm16.buffer;
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  const playAudioChunk = async (audioCtx: AudioContext, base64: string) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    
    // WebRTC typically gives us 16-bit PCM at 24kHz
    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 32768.0;
    }
    
    const audioBuffer = audioCtx.createBuffer(1, float32.length, 24000);
    audioBuffer.getChannelData(0).set(float32);
    
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioCtx.destination);
    
    const currentTime = audioCtx.currentTime;
    if (nextStartTimeRef.current < currentTime) {
      nextStartTimeRef.current = currentTime;
    }
    source.start(nextStartTimeRef.current);
    nextStartTimeRef.current += audioBuffer.duration;
  };

  const toggleLiveAPI = async () => {
    if (isLiveActive) {
      if (wsRef.current) wsRef.current.close();
      if (inputAudioCtxRef.current) inputAudioCtxRef.current.close();
      if (outputAudioCtxRef.current) outputAudioCtxRef.current.close();
      setIsLiveActive(false);
      return;
    }

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/live${geminiApiKey ? `?apiKey=${geminiApiKey}` : ''}`;
      wsRef.current = new WebSocket(wsUrl);
      
      const inputCtx = new window.AudioContext({ sampleRate: 16000 });
      inputAudioCtxRef.current = inputCtx;
      
      const outputCtx = new window.AudioContext({ sampleRate: 24000 });
      outputAudioCtxRef.current = outputCtx;
      nextStartTimeRef.current = outputCtx.currentTime;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = inputCtx.createMediaStreamSource(stream);
      const processor = inputCtx.createScriptProcessor(4096, 1, 1);
      
      source.connect(processor);
      processor.connect(inputCtx.destination);
      
      processor.onaudioprocess = (e) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          const base64 = pcmToBase64(e.inputBuffer.getChannelData(0));
          wsRef.current.send(JSON.stringify({ audio: base64 }));
        }
      };

      wsRef.current.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.audio) {
          playAudioChunk(outputCtx, msg.audio);
        }
        if (msg.interrupted) {
          nextStartTimeRef.current = outputCtx.currentTime;
        }
      };
      
      setIsLiveActive(true);
      setMessages(prev => [...prev, { role: 'assistant', text: 'Live audio connection established! Start speaking.' }]);
    } catch (err) {
      console.error("Failed to start Live API", err);
      alert("Microphone access denied or error starting audio.");
    }
  };

  const handleSend = async () => {
    if (!input.trim() && !imageFile) return;
    
    const userMsg = input.trim();
    const currentMode = mode;
    const currentImage = imageFile;
    
    setMessages(prev => [...prev, { 
      role: 'user', 
      text: userMsg || '[Image attached]',
      type: currentImage ? 'image' : 'text'
    }]);
    
    setInput('');
    setImageFile(null);
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-gemini-api-key': geminiApiKey 
        },
        body: JSON.stringify({
          prompt: userMsg,
          mode: currentMode,
          image: currentImage
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      
      setMessages(prev => [...prev, { role: 'assistant', text: data.text }]);
    } catch (error: any) {
      setMessages(prev => [...prev, { role: 'assistant', text: `Error: ${error.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = (reader.result as string).split(',')[1];
        setImageFile({ data: base64String, mimeType: file.type });
      };
      reader.readAsDataURL(file);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-96 bg-gray-900 border-l border-gray-700 shadow-2xl flex flex-col z-50">
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center">
          <Sparkles className="w-5 h-5 text-blue-400 mr-2" />
          <h2 className="text-lg font-semibold text-white">Smart Assistant</h2>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex px-2 py-3 space-x-2 border-b border-gray-800 overflow-x-auto no-scrollbar shrink-0">
        <button onClick={() => setMode('general')} className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${mode === 'general' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
          <Sparkles className="w-3.5 h-3.5 inline mr-1" /> General
        </button>
        <button onClick={() => setMode('search')} className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${mode === 'search' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
          <Search className="w-3.5 h-3.5 inline mr-1" /> Search
        </button>
        <button onClick={() => setMode('maps')} className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${mode === 'maps' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
          <MapPin className="w-3.5 h-3.5 inline mr-1" /> Maps
        </button>
        <button onClick={() => setMode('thinking')} className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${mode === 'thinking' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
          <Brain className="w-3.5 h-3.5 inline mr-1" /> Think High
        </button>
        <button onClick={() => setMode('fast')} className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${mode === 'fast' ? 'bg-yellow-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
          <Zap className="w-3.5 h-3.5 inline mr-1" /> Fast Lite
        </button>
        <button onClick={toggleLiveAPI} className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${isLiveActive ? 'bg-red-600 text-white animate-pulse' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
          {isLiveActive ? <PhoneOff className="w-3.5 h-3.5 inline mr-1" /> : <Phone className="w-3.5 h-3.5 inline mr-1" />} 
          {isLiveActive ? 'End Live' : 'Live Voice'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-10">
            <Sparkles className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm">I can organize your emails, search the web, analyze images, and chat with you in real-time. How can I help?</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
              msg.role === 'user' 
                ? 'bg-blue-600 text-white rounded-br-none' 
                : 'bg-gray-800 text-gray-200 rounded-bl-none border border-gray-700'
            }`}>
              {msg.text}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex items-start">
            <div className="bg-gray-800 rounded-2xl rounded-bl-none border border-gray-700 px-4 py-3">
              <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-gray-800 bg-gray-900">
        {imageFile && (
          <div className="mb-3 relative inline-block">
            <div className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-blue-400 flex items-center">
              <ImageIcon className="w-3.5 h-3.5 mr-2" /> Image Attached
              <button onClick={() => setImageFile(null)} className="ml-2 hover:text-white"><X className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        )}
        <div className="flex items-center space-x-2">
          <label className="p-2.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded-xl cursor-pointer transition-colors">
            <ImageIcon className="w-5 h-5" />
            <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
          </label>
          <input 
            type="text" 
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            placeholder="Ask anything..."
            className="flex-1 bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
          />
          <button 
            onClick={handleSend}
            disabled={!input.trim() && !imageFile}
            className="p-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
