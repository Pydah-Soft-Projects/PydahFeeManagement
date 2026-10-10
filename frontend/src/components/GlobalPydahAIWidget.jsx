import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Sparkles, X } from 'lucide-react';

export default function GlobalPydahAIWidget() {
    const location = useLocation();
    const [isOpen, setIsOpen] = useState(false);

    // Hide widget on public login or receipt verification pages
    if (location.pathname === '/login' || location.pathname.startsWith('/public/')) {
        return null;
    }

    return (
        <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end pointer-events-auto font-sans">
            {/* Floating Popover Chat Window (100% Sandboxed - Zero CSS Leakage) */}
            {isOpen && (
                <div className="mb-3 w-[360px] sm:w-[410px] h-[520px] max-h-[82vh] bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col animate-in fade-in slide-in-from-bottom-5 duration-200">
                    <iframe
                        title="Pydah AI Floating Assistant"
                        src="https://pydah-ai.netlify.app/"
                        className="w-full h-full border-0 block"
                        allow="clipboard-write; clipboard-read"
                    />
                </div>
            )}

            {/* Circular Trigger Button (Bottom-Right) */}
            <button
                type="button"
                onClick={() => setIsOpen(prev => !prev)}
                className="w-14 h-14 rounded-full bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 text-white shadow-xl hover:shadow-2xl hover:scale-105 active:scale-95 transition-all duration-200 flex items-center justify-center ring-4 ring-indigo-500/20 shrink-0 relative group cursor-pointer"
                title={isOpen ? "Close AI Assistant" : "Pydah AI Assistant"}
            >
                {isOpen ? (
                    <X size={24} />
                ) : (
                    <div className="relative flex items-center justify-center">
                        <Sparkles size={24} className="animate-pulse" />
                        <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-400 border-2 border-indigo-600 rounded-full" />
                    </div>
                )}
            </button>
        </div>
    );
}
