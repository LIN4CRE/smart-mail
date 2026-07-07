/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import DOMPurify from 'dompurify';
import { 
  Inbox, Mail, Send, FileText, Trash2, Search, Menu, Bell, Settings, Star, Clock, Archive, Sparkles, Loader2, LogOut, CheckCircle2, AlertTriangle, X, Reply, Copy, Eye, EyeOff, ListTodo, Smile, Globe, PenTool, Paperclip
} from 'lucide-react';
import { initAuth, googleSignIn, logout, getAccessToken } from './auth';
import SmartAssistant from './components/SmartAssistant';

type Email = {
  id: string;
  subject: string;
  sender: string;
  snippet: string;
  date: string;
  unsubscribeLink?: string;
  recommendUnsubscribe?: boolean;
  importance?: 'high' | 'medium' | 'low';
  isRead: boolean;
  hasAttachments?: boolean;
  accountEmail?: string;
};

type Account = {
  email: string;
  token: string;
};

type Category = {
  name: string;
  description: string;
  emails: Email[];
};

export default function App() {
const [needsAuth, setNeedsAuth] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Compose state
  const [isComposing, setIsComposing] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [geminiApiKey, setGeminiApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [tempApiKey, setTempApiKey] = useState(geminiApiKey);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [summarizingIds, setSummarizingIds] = useState<Record<string, boolean>>({});

  const [toast, setToast] = useState<{message: string, type: 'success' | 'error'} | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [readStatus, setReadStatus] = useState<Record<string, boolean>>({});
  const [viewedEmail, setViewedEmail] = useState<Email & { categoryName?: string } | null>(null);
  const [viewedEmailContent, setViewedEmailContent] = useState<{ html: string, text: string, attachments?: any[] } | null>(null);
  const [isDownloading, setIsDownloading] = useState<string | null>(null);
  const [isFetchingEmail, setIsFetchingEmail] = useState(false);
  
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());

  const [smartActionResult, setSmartActionResult] = useState<{type: string, text: string} | null>(null);
  const [isPerformingSmartAction, setIsPerformingSmartAction] = useState<string | null>(null);


  
  const handleDownloadAttachment = async (emailId: string, attachment: any) => {
    setIsDownloading(attachment.id);
    const token = getTokenForEmail(emailId);
    if (!token) return;
    try {
      const res = await fetch('/api/emails/attachment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: token, messageId: emailId, attachmentId: attachment.id })
      });
      const data = await res.json();
      if (data.data) {
        // convert base64 (url safe) to blob
        const base64 = data.data.replace(/-/g, '+').replace(/_/g, '/');
        const binaryString = window.atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: attachment.mimeType || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = attachment.filename || 'download';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      console.error('Failed to download attachment:', e);
      showToast('Failed to download attachment', 'error');
    } finally {
      setIsDownloading(null);
    }
  };


  const handleViewEmail = async (email: Email & { categoryName?: string }) => {
    setViewedEmail(email);
    setViewedEmailContent(null);
    setIsFetchingEmail(true);
    setSmartActionResult(null);
    const token = getTokenForEmail(email.id);
    if (!token) return;
    try {
      const res = await fetch('/api/emails/get', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: token, messageId: email.id })
      });
      const data = await res.json();
      if (res.ok) {
        setViewedEmailContent(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsFetchingEmail(false);
    }
    
    // Mark as read locally and remotely
    if (!readStatus[email.id] && !email.isRead) {
      setReadStatus(prev => ({ ...prev, [email.id]: true }));
      handleBulkAction('mark-read', new Set([email.id]));
    }
  };


  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const unsubscribe = initAuth(
      (user, t) => {
        if (user.email) {
          setAccounts(prev => {
            const existing = prev.filter(a => a.email !== user.email);
            return [...existing, { email: user.email!, token: t }];
          });
          setNeedsAuth(false);
        }
      },
      () => {
        if (accounts.length === 0) {
          setNeedsAuth(true);
        }
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (accounts.length > 0) {
      fetchEmails();
    }
  }, [accounts]);

  // Hourly checks
  useEffect(() => {
    if (accounts.length === 0) return;
    const intervalId = setInterval(() => {
      fetchEmails();
    }, 3600000);
    return () => clearInterval(intervalId);
  }, [accounts]);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      const result = await googleSignIn();
      if (result && result.user.email) {
        setAccounts(prev => {
          const existing = prev.filter(a => a.email !== result.user.email);
          return [...existing, { email: result.user.email!, token: result.accessToken }];
        });
        setNeedsAuth(false);
      }
    } catch (err) {
      console.error('Login failed:', err);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setAccounts([]);
    setCategories([]);
    setNeedsAuth(true);
  };

  const fetchEmails = async () => {
    if (accounts.length === 0) return;
    setIsLoading(true);
    setError(null);
    try {
      const allCategoryMaps = new Map<string, Category>();
      
      const promises = accounts.map(async (acc) => {
        const res = await fetch('/api/emails/organize', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-gemini-api-key': geminiApiKey 
          },
          body: JSON.stringify({ accessToken: acc.token })
        });
        if (!res.ok) throw new Error(`Failed to fetch for ${acc.email}`);
        const data = await res.json();
        const accountCategories: Category[] = data.categories || [];
        
        return { email: acc.email, categories: accountCategories };
      });
      
      const results = await Promise.allSettled(promises);
      
      for (const result of results) {
        if (result.status === 'fulfilled') {
          const accEmail = result.value.email;
          for (const cat of result.value.categories) {
            if (!allCategoryMaps.has(cat.name)) {
              allCategoryMaps.set(cat.name, { ...cat, emails: [] });
            }
            const taggedEmails = cat.emails.map(e => ({ ...e, accountEmail: accEmail }));
            allCategoryMaps.get(cat.name)!.emails.push(...taggedEmails);
          }
        } else {
          console.error(result.reason);
        }
      }
      
      setCategories(Array.from(allCategoryMaps.values()));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  
  const getTokenForEmail = (emailId: string) => {
    for (const cat of categories) {
      const em = cat.emails.find(e => e.id === emailId);
      if (em) {
        return accounts.find(a => a.email === em.accountEmail)?.token;
      }
    }
    return accounts[0]?.token; // fallback
  };

  const handleTrash = async (emailId: string) => {
    const confirmed = window.confirm('Are you sure you want to move this email to Trash?');
    const token = getTokenForEmail(emailId);
    if (!confirmed || !token) return;

    try {
      await fetch('/api/emails/trash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: token, messageId: emailId })
      });
      
      // Remove locally
      setCategories(prev => prev.map(c => ({
        ...c,
        emails: c.emails.filter(e => e.id !== emailId)
      })).filter(c => c.emails.length > 0));
      showToast("Email moved to Trash");
    } catch (err) {
      console.error('Failed to trash email:', err);
      showToast("Failed to move email to Trash", "error");
    }
  };

  const handleBulkUnsubscribe = async (emailsToUnsubscribe: Email[]) => {
    const confirmed = window.confirm(`Are you sure you want to unsubscribe from ${emailsToUnsubscribe.length} emails?`);
    if (!confirmed) return;
    const token = accounts[0]?.token;
    if (!token) return;

    try {
      showToast('Unsubscribing...');
      const links = emailsToUnsubscribe.map(e => e.unsubscribeLink).filter(Boolean);
      const messageIds = emailsToUnsubscribe.map(e => e.id);

      await fetch('/api/emails/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: token, links, messageIds })
      });
      
      // Remove locally
      setCategories(prev => prev.map(c => ({
        ...c,
        emails: c.emails.filter(e => !messageIds.includes(e.id))
      })).filter(c => c.emails.length > 0));
      
      showToast('Unsubscribe and cleanup successful!');
    } catch (err) {
      console.error('Cleanup failed:', err);
      showToast('Cleanup failed', 'error');
    }
  };

  const handleSummarize = async (emailId: string) => {
    const token = getTokenForEmail(emailId);
    if (!token) return;
    setSummarizingIds(prev => ({ ...prev, [emailId]: true }));
    try {
      const res = await fetch('/api/emails/summarize', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-gemini-api-key': geminiApiKey
        },
        body: JSON.stringify({ accessToken: token, messageId: emailId })
      });
      if (!res.ok) throw new Error('Failed to summarize email');
      const data = await res.json();
      setSummaries(prev => ({ ...prev, [emailId]: data.summary }));
    } catch (err: any) {
      showToast(err.message || 'Failed to summarize', 'error');
    } finally {
      setSummarizingIds(prev => ({ ...prev, [emailId]: false }));
    }
  };

  const handleSmartAction = async (actionType: string) => {
    if (!viewedEmail) return;
    const token = getTokenForEmail(viewedEmail.id);
    if (!token) return;
    setIsPerformingSmartAction(actionType);
    setSmartActionResult(null);
    try {
      const res = await fetch('/api/emails/smart-action', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-gemini-api-key': geminiApiKey
        },
        body: JSON.stringify({ 
          accessToken: token, 
          messageId: viewedEmail.id,
          actionType 
        })
      });
      if (!res.ok) throw new Error('Failed to perform smart action');
      const data = await res.json();
      setSmartActionResult({ type: actionType, text: data.result });
      
      if (actionType === 'smart-reply') {
        setComposeTo(viewedEmail.sender);
        setComposeSubject(viewedEmail.subject.toLowerCase().startsWith('re:') ? viewedEmail.subject : `Re: ${viewedEmail.subject}`);
        setComposeBody(data.result);
        setIsComposing(true);
        setViewedEmail(null);
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to perform smart action', 'error');
    } finally {
      setIsPerformingSmartAction(null);
    }
  };

  const handleBulkAction = async (action: 'trash' | 'mark-read' | 'mark-unread' | 'unsubscribe', specificIds?: Set<string>) => {
    const ids = specificIds || selectedEmails;
    if (ids.size === 0) return;
    // For bulk actions, we'll just use the token of the first selected email for simplicity
    const firstSelectedId = Array.from(ids)[0] as string;
    const token = getTokenForEmail(firstSelectedId);
    if (!token) return;
    const messageIds = Array.from(selectedEmails);
    try {
      if (action === 'unsubscribe') {
        const emailsToUnsubscribe = categories.flatMap(c => c.emails).filter(e => selectedEmails.has(e.id));
        const links = emailsToUnsubscribe.map(e => e.unsubscribeLink).filter(Boolean);
        if (links.length === 0) {
          showToast('No unsubscribe links found in selected emails.', 'error');
          return;
        }
        await fetch('/api/emails/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessToken: token, links, messageIds })
        });
        setCategories(prev => prev.map(c => ({
          ...c,
          emails: c.emails.filter(e => !selectedEmails.has(e.id))
        })).filter(c => c.emails.length > 0));
        setSelectedEmails(new Set());
        showToast('Successfully unsubscribed and trashed selected emails.');
        return;
      }

      const res = await fetch('/api/emails/bulk-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: token, messageIds, action })
      });
      if (!res.ok) throw new Error(`Failed to bulk ${action}`);
      
      if (action === 'trash') {
        setCategories(prev => prev.map(c => ({
          ...c,
          emails: c.emails.filter(e => !selectedEmails.has(e.id))
        })).filter(c => c.emails.length > 0));
      } else {
        const isRead = action === 'mark-read';
        setReadStatus(prev => {
          const updated = { ...prev };
          selectedEmails.forEach(id => { updated[id] = isRead; });
          return updated;
        });
      }
      setSelectedEmails(new Set());
      showToast(`Emails ${action === 'trash' ? 'deleted' : action === 'mark-read' ? 'marked as read' : 'marked as unread'}`);
    } catch (err: any) {
      showToast(err.message || 'Bulk action failed', 'error');
    }
  };

  const toggleSelectAll = (visibleIds: string[]) => {
    if (selectedEmails.size === visibleIds.length && visibleIds.length > 0) {
      setSelectedEmails(new Set());
    } else {
      setSelectedEmails(new Set(visibleIds));
    }
  };

  const toggleEmailSelection = (id: string, e: React.ChangeEvent | React.MouseEvent) => {
    e.stopPropagation();
    const newSet = new Set(selectedEmails);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedEmails(newSet);
  };

  const handleSend = async () => {
    const token = accounts[0]?.token;
    if (!token || !composeTo || !composeSubject || !composeBody) {
      showToast("Please fill in all fields.", "error");
      return;
    }
    
    setIsSending(true);
    try {
      const res = await fetch('/api/emails/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: token,
          to: composeTo,
          subject: composeSubject,
          body: composeBody
        })
      });
      if (!res.ok) throw new Error("Failed to send email");
      
      setIsComposing(false);
      setComposeTo('');
      setComposeSubject('');
      setComposeBody('');
      showToast("Email sent successfully!");
    } catch (err: any) {
      showToast(err.message || "Failed to send email.", "error");
    } finally {
      setIsSending(false);
    }
  };

  const handleQuickReply = (email: Email) => {
    setComposeTo(email.sender);
    setComposeSubject(email.subject.toLowerCase().startsWith('re:') ? email.subject : `Re: ${email.subject}`);
    setComposeBody(`\n\nOn ${email.date}, ${email.sender} wrote:\n> ${email.snippet}`);
    setIsComposing(true);
  };

  const toggleReadStatus = (emailId: string, currentIsRead: boolean) => {
    setReadStatus(prev => ({ ...prev, [emailId]: !currentIsRead }));
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast("Summary copied to clipboard");
  };

  if (needsAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 font-sans">
        <div className="max-w-md w-full bg-gray-800 p-8 rounded-2xl shadow-lg border border-gray-700 text-center space-y-6">
          <div className="mx-auto w-20 h-20 relative bg-gradient-to-br from-indigo-900/50 to-blue-900/20 rounded-2xl flex items-center justify-center mb-6 border border-indigo-500/20 shadow-[0_0_30px_-5px_rgba(79,70,229,0.3)]">
            <Mail className="w-10 h-10 text-indigo-400" />
            <Sparkles className="w-5 h-5 text-blue-400 absolute top-4 right-4 animate-pulse" />
          </div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">AI Smart Inbox</h1>
          <p className="text-gray-400 pb-4 text-sm leading-relaxed">
            Connect your Gmail to let Gemini automatically organize your emails, detect subscriptions, and keep your inbox perfectly clean.
          </p>
          <button 
            onClick={handleLogin}
            disabled={isLoggingIn}
            className="w-full flex items-center justify-center py-3 px-4 border border-gray-600 rounded-xl shadow-sm bg-gray-800 text-sm font-medium text-gray-200 hover:bg-gray-700 hover:border-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-blue-500 transition-all disabled:opacity-50"
          >
            {isLoggingIn ? <Loader2 className="w-5 h-5 animate-spin text-gray-400" /> : (
              <>
                <svg className="w-5 h-5 mr-3" viewBox="0 0 48 48">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                  <path fill="none" d="M0 0h48v48H0z"></path>
                </svg>
                Sign in with Google
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  const allUnwanted = categories.flatMap(c => c.emails.filter(e => e.recommendUnsubscribe));
  const filteredUnwanted = allUnwanted.filter(e => 
    e.subject.toLowerCase().includes(searchQuery.toLowerCase()) || 
    e.sender.toLowerCase().includes(searchQuery.toLowerCase()) || 
    e.snippet.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const validEmails = categories
    .flatMap(c => c.emails.map(e => ({ ...e, categoryName: c.name })))
    .filter(e => !e.recommendUnsubscribe)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
  const filteredValidEmails = validEmails.filter(e => 
    e.subject.toLowerCase().includes(searchQuery.toLowerCase()) || 
    e.sender.toLowerCase().includes(searchQuery.toLowerCase()) || 
    e.snippet.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100 font-sans">
      <aside className="w-64 bg-gray-800 border-r border-gray-700 flex-col hidden md:flex">
        <div className="h-16 flex items-center px-6 border-b border-gray-700">
          <div className="relative mr-3">
            <Mail className="w-6 h-6 text-indigo-400" />
            <Sparkles className="w-3 h-3 text-blue-400 absolute -top-1 -right-1" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-white">AI Inbox</span>
        </div>
        
        <div className="p-4">
          <button onClick={() => setIsComposing(true)} className="w-full bg-blue-600 hover:bg-blue-500 glow-blue text-white font-medium py-2.5 px-4 rounded-xl flex items-center justify-center transition-all shadow-sm">
            <span className="mr-2">+</span> Compose
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2 px-3 space-y-1">
          <div className="flex items-center px-3 py-2.5 rounded-lg text-sm font-medium bg-blue-900/50 text-blue-400">
            <Inbox className="w-4 h-4 mr-3" /> Inbox
          </div>
          <div className="flex items-center px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:bg-gray-700 hover:text-gray-200 cursor-pointer">
            <Star className="w-4 h-4 mr-3" /> Starred
          </div>
          <div className="flex items-center px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:bg-gray-700 hover:text-gray-200 cursor-pointer">
            <Send className="w-4 h-4 mr-3" /> Sent
          </div>
        </nav>
        
        <div className="p-4 border-t border-gray-700">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2 px-3">Accounts</div>
          <div className="flex items-center px-3 py-2 text-sm text-gray-300">
            <div className="w-2 h-2 rounded-full bg-green-500 mr-2"></div>
            Primary Account
          </div>
        </div>

        <div className="p-4 border-t border-gray-700">
          <button onClick={handleLogout} className="flex items-center text-sm font-medium text-gray-400 hover:text-white transition-colors w-full px-3 py-2 rounded-lg hover:bg-gray-700">
            <LogOut className="w-4 h-4 mr-3" /> Sign Out
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 bg-gray-900">
        <header className="h-16 bg-gray-800 border-b border-gray-700 flex items-center justify-between px-4 sm:px-6 z-10 shrink-0">
          <div className="flex items-center flex-1">
            <Menu className="w-5 h-5 text-gray-400 mr-4 cursor-pointer hover:text-white md:hidden" />
            <div className="max-w-2xl w-full">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search smartly..."
                  className="block w-full pl-10 pr-3 py-2 border border-gray-700 rounded-xl leading-5 bg-gray-900 text-white placeholder-gray-500 focus:outline-none focus:bg-gray-800 focus:ring-2 focus:ring-blue-500 sm:text-sm transition-all"
                />
              </div>
            </div>
          </div>
          <div className="flex items-center space-x-4 ml-4">
            <button onClick={() => fetchEmails()} className="text-gray-400 hover:text-white transition-colors" title="Refresh">
              <Clock className="w-5 h-5" />
            </button>
            <Settings onClick={() => setIsSettingsOpen(true)} className="w-5 h-5 text-gray-400 cursor-pointer hover:text-white" />
            <button 
              onClick={() => setIsAssistantOpen(true)}
              className="ml-4 bg-purple-600/10 text-purple-400 hover:bg-purple-600 hover:text-white glow-purple px-4 py-1.5 rounded-full text-sm font-medium transition-all flex items-center"
            >
              <Sparkles className="w-4 h-4 mr-1.5" />
              Smart Assistant
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-8">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <Loader2 className="w-8 h-8 animate-spin mb-4 text-blue-500" />
              <p className="font-medium">Gemini is organizing your inbox...</p>
            </div>
          ) : error ? (
            <div className="bg-red-900/30 border border-red-800/50 text-red-400 p-4 rounded-xl flex items-center">
              <AlertTriangle className="w-5 h-5 mr-3" />
              {error}
            </div>
          ) : categories.length === 0 ? (
            <div className="text-center py-20">
              <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-white">You're all caught up!</h3>
              <p className="text-gray-400 mt-1">No recent emails found in your inbox.</p>
            </div>
          ) : (
            <>
              {filteredUnwanted.length > 0 && (
                <div className="bg-indigo-900/30 border border-indigo-800/50 rounded-2xl p-6 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-indigo-200 flex items-center">
                      <Sparkles className="w-5 h-5 mr-2 text-indigo-400" />
                      AI Cleanup Recommendation
                    </h2>
                    <p className="text-indigo-300 text-sm mt-1">
                      Found {filteredUnwanted.length} subscriptions or promotional emails you might want to trash.
                    </p>
                  </div>
                  <button 
                    onClick={() => handleBulkUnsubscribe(filteredUnwanted)}
                    className="mt-4 sm:mt-0 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-medium text-sm transition-colors shadow-sm"
                  >
                    Unsubscribe All ({filteredUnwanted.length})
                  </button>
                </div>
              )}

              <div className="bg-gray-800 rounded-2xl shadow-sm border border-gray-700 overflow-hidden relative">
                <div className="px-6 py-4 border-b border-gray-700 bg-gray-800/50 flex items-center justify-between">
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      className="mr-3 w-4 h-4 rounded border-gray-600 text-blue-600 focus:ring-blue-500 focus:ring-offset-gray-800 bg-gray-700 cursor-pointer"
                      checked={filteredValidEmails.length > 0 && selectedEmails.size === filteredValidEmails.length}
                      onChange={() => toggleSelectAll(filteredValidEmails.map(e => e.id))}
                    />
                    <h3 className="text-base font-semibold text-white">Unified Inbox</h3>
                  </div>
                  <span className="text-xs text-gray-400 font-medium bg-gray-700 px-2 py-1 rounded-md">{filteredValidEmails.length} messages</span>
                </div>
                {filteredValidEmails.length === 0 ? (
                  <div className="py-12 text-center text-gray-500 text-sm">No emails match your search.</div>
                ) : (
                  <div className="divide-y divide-gray-700 mb-16">
                    {filteredValidEmails.map(email => {
                      const isEmailRead = readStatus[email.id] ?? email.isRead;
                      return (
                        <div key={email.id} className="group flex flex-col sm:flex-row sm:items-center px-6 py-4 hover:bg-gray-700/50 transition-colors">
                          <div className="mr-4 flex items-center pt-1 sm:pt-0">
                            <input
                              type="checkbox"
                              className="w-4 h-4 rounded border-gray-600 text-blue-600 focus:ring-blue-500 focus:ring-offset-gray-800 bg-gray-700 cursor-pointer"
                              checked={selectedEmails.has(email.id)}
                              onChange={(e) => toggleEmailSelection(email.id, e)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>
                          <div className="flex-1 min-w-0 flex flex-col cursor-pointer" onClick={() => handleViewEmail(email)}>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-2">
                                <span className={`text-sm ${!isEmailRead ? 'font-semibold text-white' : 'text-gray-300'}`}>
                                  {email.sender}
                                </span>
                                <span className="text-[10px] uppercase tracking-wider font-semibold bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded">
                                  {email.categoryName}
                                </span>

                          </div>
                          <span className="text-xs text-gray-500 sm:hidden">{email.date}</span>
                        </div>
                        <div className="flex items-center space-x-2 mt-0.5">
                          <span className={`text-sm truncate ${
                            !isEmailRead 
                              ? email.importance === 'high' ? 'font-semibold text-red-400' 
                                : email.importance === 'medium' ? 'font-semibold text-yellow-400'
                                : 'font-semibold text-white'
                              : 'text-gray-400'
                          }`}>
                            {email.subject}
                          </span>
                          {email.hasAttachments && (
                            <Paperclip className="w-3.5 h-3.5 text-gray-400 shrink-0" title="Has attachments" />
                          )}
                        </div>
                        <span className="text-sm text-gray-400 truncate mt-0.5">
                          {email.snippet}
                        </span>
                        {summaries[email.id] && (
                          <div className="mt-2 bg-blue-900/20 border border-blue-800/50 p-3 rounded-lg text-sm text-blue-200 relative group/summary">
                            <Sparkles className="w-4 h-4 inline mr-2 text-blue-400" />
                            {summaries[email.id]}
                            <button 
                              onClick={(e) => { e.stopPropagation(); copyToClipboard(summaries[email.id]); }}
                              className="absolute top-2 right-2 p-1.5 bg-blue-800/50 hover:bg-blue-700 text-blue-300 rounded opacity-0 group-hover/summary:opacity-100 transition-opacity"
                              title="Copy Summary"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="mt-3 sm:mt-0 sm:ml-4 flex items-center justify-between sm:justify-end sm:w-auto">
                        <div className="flex items-center space-x-1.5 text-gray-500 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                          <button 
                            onClick={(e) => { e.stopPropagation(); toggleReadStatus(email.id, isEmailRead); }} 
                            className="p-1.5 hover:text-white hover:bg-gray-700 rounded-lg transition-colors" 
                            title={isEmailRead ? "Mark as unread" : "Mark as read"}
                          >
                            {isEmailRead ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleQuickReply(email); }} 
                            className="p-1.5 hover:text-green-400 hover:bg-green-900/30 rounded-lg transition-colors" 
                            title="Quick Reply"
                          >
                            <Reply className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleSummarize(email.id); }} 
                            disabled={summarizingIds[email.id]} 
                            className="p-1.5 hover:text-blue-400 hover:bg-blue-900/30 rounded-lg transition-colors disabled:opacity-50" 
                            title="Summarize with Smart Assistant"
                          >
                            {summarizingIds[email.id] ? <Loader2 className="w-4 h-4 animate-spin text-blue-400" /> : <Sparkles className="w-4 h-4" />}
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); handleTrash(email.id); }} className="p-1.5 hover:text-red-400 hover:bg-red-900/30 rounded-lg transition-colors" title="Trash">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        <span className="text-xs text-gray-500 hidden sm:block ml-4 whitespace-nowrap min-w-[60px] text-right">
                          {email.date.split(' ')[0] || 'Recent'}
                        </span>
                      </div>
                    </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {selectedEmails.size > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 border border-gray-600 shadow-2xl rounded-full px-6 py-3 flex items-center space-x-6 z-40 transition-transform">
            <span className="text-sm font-medium text-white">{selectedEmails.size} selected</span>
            <div className="h-4 w-px bg-gray-700"></div>
            <button onClick={() => handleBulkAction('mark-read')} className="text-gray-300 hover:text-white transition-colors flex items-center" title="Mark as Read">
              <Eye className="w-4 h-4 mr-1.5" /> <span className="text-xs">Read</span>
            </button>
            <button onClick={() => handleBulkAction('mark-unread')} className="text-gray-300 hover:text-white transition-colors flex items-center" title="Mark as Unread">
              <EyeOff className="w-4 h-4 mr-1.5" /> <span className="text-xs">Unread</span>
            </button>
            <button onClick={() => handleBulkAction('unsubscribe')} className="text-indigo-400 hover:text-indigo-300 transition-colors flex items-center" title="Unsubscribe">
              <LogOut className="w-4 h-4 mr-1.5" /> <span className="text-xs">Unsubscribe</span>
            </button>
            <button onClick={() => handleBulkAction('trash')} className="text-red-400 hover:text-red-300 transition-colors flex items-center" title="Delete">
              <Trash2 className="w-4 h-4 mr-1.5" /> <span className="text-xs">Trash</span>
            </button>
          </div>
        )}
      </main>

      {/* Compose Modal */}
      {isComposing && (
        <div className="fixed bottom-0 right-0 sm:bottom-4 sm:right-10 w-full sm:w-[500px] bg-gray-800 border border-gray-700 shadow-2xl rounded-t-xl sm:rounded-xl overflow-hidden flex flex-col z-50">
          <div className="bg-gray-900 px-4 py-3 border-b border-gray-700 flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">New Message</h3>
            <button onClick={() => setIsComposing(false)} className="text-gray-400 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex flex-col flex-1 p-0">
            <input 
              type="text" 
              placeholder="To" 
              value={composeTo}
              onChange={e => setComposeTo(e.target.value)}
              className="w-full px-4 py-2 border-b border-gray-700 bg-gray-800 text-white placeholder-gray-500 focus:outline-none text-sm"
            />
            <input 
              type="text" 
              placeholder="Subject" 
              value={composeSubject}
              onChange={e => setComposeSubject(e.target.value)}
              className="w-full px-4 py-2 border-b border-gray-700 bg-gray-800 text-white placeholder-gray-500 focus:outline-none text-sm font-medium"
            />
            <textarea 
              placeholder="Write something..." 
              value={composeBody}
              onChange={e => setComposeBody(e.target.value)}
              className="w-full px-4 py-3 bg-gray-800 text-white placeholder-gray-500 focus:outline-none text-sm resize-none h-64"
            />
          </div>
          <div className="bg-gray-800 px-4 py-3 border-t border-gray-700 flex items-center justify-between">
            <button 
              onClick={handleSend}
              disabled={isSending}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium text-sm transition-colors shadow-sm disabled:opacity-50 flex items-center"
            >
              {isSending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : 'Send'}
            </button>
            <button onClick={() => setIsComposing(false)} className="text-gray-400 hover:text-red-400 transition-colors p-2 rounded-lg hover:bg-gray-700">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Smart Assistant Sidebar */}
      <SmartAssistant isOpen={isAssistantOpen} onClose={() => setIsAssistantOpen(false)} geminiApiKey={geminiApiKey} />

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-gray-800 rounded-2xl border border-gray-700 shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between bg-gray-800/50 shrink-0">
              <h3 className="text-lg font-semibold text-white">Settings</h3>
              <button onClick={() => setIsSettingsOpen(false)} className="text-gray-400 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto">
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-300">
                    Gemini API Key
                  </label>
                  <a 
                    href="https://aistudio.google.com/app/apikey" 
                    target="_blank" 
                    rel="noreferrer"
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors flex items-center"
                  >
                    Get API Key <Globe className="w-3 h-3 ml-1" />
                  </a>
                </div>
                <input
                  type="password"
                  value={tempApiKey}
                  onChange={(e) => setTempApiKey(e.target.value)}
                  placeholder="Leave empty to use server default"
                  className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-sm mb-2"
                />
                <p className="text-xs text-gray-500 leading-relaxed">
                  Provide your own Gemini API key if you want to use a custom one. Otherwise, the app uses the built-in AI Studio key.
                </p>
              </div>
              
              <div className="mb-6 pt-6 border-t border-gray-700">
                <h4 className="text-sm font-medium text-gray-300 mb-3">Accounts</h4>
                <button
                  onClick={() => {
                    setIsSettingsOpen(false);
                    handleLogin();
                  }}
                  className="w-full bg-gray-700 hover:bg-gray-600 text-white rounded-xl py-2.5 font-medium transition-colors flex items-center justify-center text-sm"
                >
                  <svg className="w-4 h-4 mr-2" viewBox="0 0 48 48">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                  </svg>
                  Add / Switch Google Account
                </button>
              </div>

              <div className="pt-4 border-t border-gray-700">
                <button
                  onClick={() => {
                    setGeminiApiKey(tempApiKey);
                    localStorage.setItem('gemini_api_key', tempApiKey);
                    setIsSettingsOpen(false);
                  }}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-2.5 font-medium transition-colors shadow-sm"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* View Email Modal */}
      {viewedEmail && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4 sm:p-6">
          <div className="bg-gray-800 rounded-2xl border border-gray-700 shadow-2xl w-full max-w-2xl max-h-full overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-700 flex items-start justify-between bg-gray-800/50">
              <div>
                <h3 className="text-lg font-semibold text-white pr-4">{viewedEmail.subject}</h3>
                <p className="text-sm text-gray-400 mt-1">{viewedEmail.sender} • {viewedEmail.date}</p>
              </div>
              <button onClick={() => setViewedEmail(null)} className="text-gray-400 hover:text-white transition-colors mt-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto">
              <div className="flex flex-wrap gap-2 mb-6">
                <button 
                  onClick={() => handleSmartAction('smart-reply')} 
                  disabled={isPerformingSmartAction === 'smart-reply'}
                  className="bg-blue-900/30 hover:bg-blue-900/50 text-blue-400 border border-blue-800/50 px-3 py-1.5 rounded-lg font-medium text-xs transition-colors flex items-center disabled:opacity-50"
                >
                  {isPerformingSmartAction === 'smart-reply' ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <PenTool className="w-3.5 h-3.5 mr-1.5" />} Auto-Draft Reply
                </button>
                <button 
                  onClick={() => handleSmartAction('extract-tasks')} 
                  disabled={isPerformingSmartAction === 'extract-tasks'}
                  className="bg-purple-900/30 hover:bg-purple-900/50 text-purple-400 border border-purple-800/50 px-3 py-1.5 rounded-lg font-medium text-xs transition-colors flex items-center disabled:opacity-50"
                >
                  {isPerformingSmartAction === 'extract-tasks' ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <ListTodo className="w-3.5 h-3.5 mr-1.5" />} Extract Tasks
                </button>
                <button 
                  onClick={() => handleSmartAction('priority')} 
                  disabled={isPerformingSmartAction === 'priority'}
                  className="bg-orange-900/30 hover:bg-orange-900/50 text-orange-400 border border-orange-800/50 px-3 py-1.5 rounded-lg font-medium text-xs transition-colors flex items-center disabled:opacity-50"
                >
                  {isPerformingSmartAction === 'priority' ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <AlertTriangle className="w-3.5 h-3.5 mr-1.5" />} Priority Check
                </button>
                <button 
                  onClick={() => handleSmartAction('sentiment')} 
                  disabled={isPerformingSmartAction === 'sentiment'}
                  className="bg-yellow-900/30 hover:bg-yellow-900/50 text-yellow-400 border border-yellow-800/50 px-3 py-1.5 rounded-lg font-medium text-xs transition-colors flex items-center disabled:opacity-50"
                >
                  {isPerformingSmartAction === 'sentiment' ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Smile className="w-3.5 h-3.5 mr-1.5" />} Tone Analysis
                </button>
                <button 
                  onClick={() => handleSmartAction('translate')} 
                  disabled={isPerformingSmartAction === 'translate'}
                  className="bg-green-900/30 hover:bg-green-900/50 text-green-400 border border-green-800/50 px-3 py-1.5 rounded-lg font-medium text-xs transition-colors flex items-center disabled:opacity-50"
                >
                  {isPerformingSmartAction === 'translate' ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Globe className="w-3.5 h-3.5 mr-1.5" />} Translate
                </button>
              </div>

              {smartActionResult && (
                <div className="mb-6 bg-gray-800/80 border border-gray-600 p-4 rounded-xl text-sm text-gray-200 relative group/result">
                  <h4 className="font-medium text-white mb-2 flex items-center capitalize">
                    <Sparkles className="w-4 h-4 inline mr-2 text-blue-400" />
                    {smartActionResult.type.replace('-', ' ')} Result
                  </h4>
                  <div className="whitespace-pre-wrap">{smartActionResult.text}</div>
                  <button 
                    onClick={() => copyToClipboard(smartActionResult.text)}
                    className="absolute top-4 right-4 p-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded opacity-0 group-hover/result:opacity-100 transition-opacity"
                    title="Copy Result"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              )}

              {summaries[viewedEmail.id] && (
                <div className="mb-6 bg-blue-900/20 border border-blue-800/50 p-4 rounded-xl text-sm text-blue-200 relative group/summary">
                  <h4 className="font-medium text-blue-300 mb-2 flex items-center">
                    <Sparkles className="w-4 h-4 inline mr-2 text-blue-400" />
                    AI Summary
                  </h4>
                  {summaries[viewedEmail.id]}
                  <button 
                    onClick={() => copyToClipboard(summaries[viewedEmail.id])}
                    className="absolute top-4 right-4 p-1.5 bg-blue-800/50 hover:bg-blue-700 text-blue-300 rounded opacity-0 group-hover/summary:opacity-100 transition-opacity"
                    title="Copy Summary"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              )}
              {viewedEmailContent?.attachments && viewedEmailContent.attachments.length > 0 && (
                <div className="mb-6 bg-gray-800/80 border border-gray-600 p-4 rounded-xl">
                  <h4 className="font-medium text-gray-300 mb-3 flex items-center text-sm">
                    <Paperclip className="w-4 h-4 mr-2" />
                    Attachments ({viewedEmailContent.attachments.length})
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {viewedEmailContent.attachments.map(att => (
                      <button
                        key={att.id}
                        onClick={() => handleDownloadAttachment(viewedEmail.id, att)}
                        disabled={isDownloading === att.id}
                        className="bg-gray-700 hover:bg-gray-600 text-gray-200 px-3 py-2 rounded-lg text-xs font-medium flex items-center transition-colors disabled:opacity-50"
                      >
                        {isDownloading === att.id ? (
                          <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                        ) : (
                          <FileText className="w-3.5 h-3.5 mr-2" />
                        )}
                        <span className="truncate max-w-[150px]">{att.filename}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-gray-300 text-sm leading-relaxed overflow-x-hidden">
                {isFetchingEmail ? (
                  <div className="flex justify-center py-10">
                    <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
                  </div>
                ) : viewedEmailContent ? (
                  viewedEmailContent.html ? (
                    <div className="email-html-container bg-white text-black p-4 rounded-lg" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(viewedEmailContent.html) }} />
                  ) : (
                    <div className="whitespace-pre-wrap">{viewedEmailContent.text || viewedEmail.snippet}</div>
                  )
                ) : (
                  <div className="whitespace-pre-wrap">{viewedEmail.snippet}</div>
                )}
              </div>
            </div>
            
            <div className="bg-gray-800 px-6 py-4 border-t border-gray-700 flex items-center justify-end space-x-3">
              <button 
                onClick={() => { handleQuickReply(viewedEmail); setViewedEmail(null); }}
                className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg font-medium text-sm transition-colors flex items-center"
              >
                <Reply className="w-4 h-4 mr-2" /> Reply
              </button>
              <button 
                onClick={() => { handleTrash(viewedEmail.id); setViewedEmail(null); }}
                className="bg-red-900/30 hover:bg-red-900/50 text-red-400 px-4 py-2 rounded-lg font-medium text-sm transition-colors flex items-center"
              >
                <Trash2 className="w-4 h-4 mr-2" /> Trash
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notifications */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-3 rounded-full shadow-lg text-sm font-medium flex items-center z-[100] transition-all animate-in fade-in slide-in-from-bottom-4 ${toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}>
          {toast.type === 'error' ? <AlertTriangle className="w-4 h-4 mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
          {toast.message}
        </div>
      )}
    </div>
  );
}

