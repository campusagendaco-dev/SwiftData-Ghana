import { useState } from "react";
import { Outlet } from "react-router-dom";
import DashboardSidebar from "@/components/DashboardSidebar";

import NotificationPopup from "@/components/NotificationPopup";
import { Menu } from "lucide-react";

const DashboardLayout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen w-full">
      <DashboardSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col overflow-auto">
        {/* Mobile header */}
        <div className="md:hidden flex items-center h-14 border-b border-border bg-card px-4">
          <button onClick={() => setSidebarOpen(true)} className="text-foreground">
            <Menu className="w-6 h-6" />
          </button>
          <span className="ml-3 font-display font-bold text-sm">DataHive GH</span>
        </div>
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
      
      <NotificationPopup />
    </div>
  );
};

export default DashboardLayout;
