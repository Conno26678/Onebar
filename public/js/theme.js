// Theme management (thanks to ChatGPT)
class ThemeManager {
  constructor() {
    this.currentTheme = localStorage.getItem('theme') || 'light';
    this.init();
  }

  init() {
    // Apply saved theme on page load
    this.applyTheme(this.currentTheme);
    
    // Create theme toggle button
    this.createToggleButton();
    
    // Add fade-in animation to body
    document.body.classList.add('fade-in');
  }

  createToggleButton() {
    const toggleButton = document.createElement('button');
    toggleButton.className = 'theme-toggle';
    toggleButton.setAttribute('aria-label', 'Toggle theme');
    toggleButton.innerHTML = this.currentTheme === 'dark' ? '☀️' : '🌙';
    
    toggleButton.addEventListener('click', () => {
      this.toggleTheme();
    });
    
    document.body.appendChild(toggleButton);
  }

  applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    this.currentTheme = theme;
    localStorage.setItem('theme', theme);
    
    // Update toggle button icon if it exists
    const toggleButton = document.querySelector('.theme-toggle');
    if (toggleButton) {
      toggleButton.innerHTML = theme === 'dark' ? '☀️' : '🌙';
    }
  }

  toggleTheme() {
    const newTheme = this.currentTheme === 'light' ? 'dark' : 'light';
    this.applyTheme(newTheme);
    
    // Add a subtle animation to indicate the change
    document.body.style.transform = 'scale(0.98)';
    setTimeout(() => {
      document.body.style.transform = 'scale(1)';
    }, 150);
  }

  getTheme() {
    return this.currentTheme;
  }
}

// Auto-detect system preference if no saved preference
function getSystemTheme() {
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

// Initialize theme manager when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  // If no saved theme, use system preference
  if (!localStorage.getItem('theme')) {
    localStorage.setItem('theme', getSystemTheme());
  }
  
  window.themeManager = new ThemeManager();
});

// Listen for system theme changes
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    // Only auto-switch if user hasn't manually set a preference
    if (!localStorage.getItem('theme-manually-set')) {
      const systemTheme = e.matches ? 'dark' : 'light';
      if (window.themeManager) {
        window.themeManager.applyTheme(systemTheme);
      }
    }
  });
}

// Mark theme as manually set when user toggles
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('theme-toggle')) {
    localStorage.setItem('theme-manually-set', 'true');
  }
});