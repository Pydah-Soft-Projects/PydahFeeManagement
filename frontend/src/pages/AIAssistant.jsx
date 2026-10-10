import React, { useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import { isAuthenticated } from '../lib/auth';
import { useNavigate } from 'react-router-dom';
import { Menu } from 'lucide-react';

export default function AIAssistant() {
    const navigate = useNavigate();
    const [isOpenMobile, setIsOpenMobile] = useState(false);

    // Ensure session authentication
    useEffect(() => {
        if (!isAuthenticated()) {
            navigate('/login', { replace: true });
        }
    }, [navigate]);

    return (
        <div className="flex h-screen bg-slate-100 font-sans text-slate-900 overflow-hidden">
            {/* Sidebar Navigation */}
            <Sidebar isOpenMobile={isOpenMobile} onCloseMobile={() => setIsOpenMobile(false)} />

            {/* Main Content Workspace Container */}
            <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0 relative">
                {/* Mobile Navigation Toggle Button */}
                <button
                    type="button"
                    onClick={() => setIsOpenMobile(true)}
                    className="md:hidden absolute top-3 left-3 z-30 p-2 rounded-xl bg-slate-900/80 text-white shadow-lg hover:bg-slate-800 focus:outline-none"
                    title="Open navigation menu"
                >
                    <Menu size={18} />
                </button>

                {/* Clean 100% Full-Workspace Pydah AI Chat UI */}
                <iframe
                    title="Pydah AI Workspace"
                    src="https://pydah-ai.netlify.app/"
                    className="w-full h-full border-0 block"
                    allow="clipboard-write; clipboard-read"
                />
            </div>
        </div>
    );
}
