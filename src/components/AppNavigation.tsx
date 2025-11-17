import { Link, useLocation } from '@tanstack/react-router';
import { LogOut, Shield, User } from 'lucide-react';
import { MobileNavigation } from '~/components/MobileNavigation';
import { NotificationsMenu } from '~/components/NotificationsMenu';
import { ThemeToggle } from '~/components/theme-toggle';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { navigationMenuTriggerStyle } from '~/components/ui/navigation-menu';
import { signOut } from '~/features/auth/auth-client';
import { useAuth } from '~/features/auth/hooks/useAuth';
import { useAuthState } from '~/features/auth/hooks/useAuthState';
import { cn, getAppName } from '~/lib/utils';

/**
 * Authentication Navigation - Sign in/out links
 */
function AuthNavigation({ currentPath }: { currentPath: string }) {
  const authState = useAuthState();
  const { user, isAuthenticated, isPending, isAdmin } = useAuth({
    fetchRole: authState.isAuthenticated,
  });

  const handleSignOut = async () => {
    try {
      console.log('🔄 DESKTOP NAVIGATION: Starting sign out process');
      await signOut();
      console.log('✅ DESKTOP NAVIGATION: Sign out completed successfully');

      // Force a full page reload to ensure all auth state is cleared
      // This is more reliable than trying to manage complex state transitions
      console.log('🔄 DESKTOP NAVIGATION: Reloading page to clear all state');
      window.location.href = '/login';
    } catch (error) {
      console.error('❌ DESKTOP NAVIGATION: Error signing out:', error);
      // Even on error, force a reload to clear state
      console.log('🔄 DESKTOP NAVIGATION: Reloading page after error');
      window.location.href = '/login';
    }
  };

  if (isAuthenticated || isPending) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center justify-center w-8 h-8 rounded-full bg-secondary hover:bg-secondary/80 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            title="User menu"
          >
            {user?.name ? (
              <span className="text-sm font-medium text-secondary-foreground">
                {user.name.charAt(0).toUpperCase()}
              </span>
            ) : (
              <User className="w-4 h-4 text-muted-foreground" />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {isAdmin && (
            <DropdownMenuItem asChild>
              <Link
                to="/app/admin"
                className="flex items-center gap-2 w-full cursor-pointer text-destructive hover:text-destructive focus:text-destructive"
              >
                <Shield className="w-4 h-4" />
                Admin
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Link to="/app/profile" className="flex items-center gap-2 w-full cursor-pointer">
              <User className="w-4 h-4" />
              Profile
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={handleSignOut}
            className="flex items-center gap-2 cursor-pointer text-destructive focus:text-destructive"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div className="flex items-center space-x-4">
      <Link
        to="/login"
        preload="intent"
        search={{ reset: '', redirect: currentPath }}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        Sign in
      </Link>
      <Link
        to="/register"
        preload="intent"
        className="text-sm bg-primary text-primary-foreground px-3 py-2 rounded-md hover:bg-primary/90"
      >
        Sign up
      </Link>
    </div>
  );
}

/**
 * Main Application Navigation Component
 */
export function AppNavigation() {
  const location = useLocation();

  return (
    <nav className="bg-card shadow-sm border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 overflow-visible">
          {/* Mobile Logo - Left side */}
          <div className="flex items-center md:hidden">
            <Link
              to="/"
              preload="intent"
              className="focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded"
            >
              <img
                src="/android-chrome-192x192.png"
                alt={`${getAppName()} Logo`}
                className="w-8 h-8 rounded hover:opacity-80 transition-opacity"
              />
            </Link>
          </div>

          {/* Desktop Navigation - Hidden on mobile */}
          <div className="hidden md:flex items-center space-x-2">
            {/* Logo */}
            <Link
              to="/"
              preload="intent"
              className="focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded"
            >
              <img
                src="/android-chrome-192x192.png"
                alt={`${getAppName()} Logo`}
                className="w-8 h-8 rounded hover:opacity-80 transition-opacity"
              />
            </Link>

            {/* Navigation Links */}
            <div className="flex items-center space-x-1">
              <Link
                to="/h"
                preload="intent"
                className={cn(navigationMenuTriggerStyle(), 'no-underline')}
              >
                Hackathons
              </Link>
            </div>
          </div>

          {/* Right side - Mobile menu on mobile, Auth nav on desktop */}
          <div className="flex items-center">
            {/* Mobile Navigation - Right side */}
            <div className="md:hidden">
              <MobileNavigation />
            </div>

            {/* Desktop utilities */}
            <div className="hidden md:flex items-center space-x-2">
              <NotificationsMenu />
              <ThemeToggle />
              <AuthNavigation currentPath={location.pathname} />
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
