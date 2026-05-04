// Theme management - Now supports multiple themes
class ThemeManager {
  constructor() {
    // Check if there's a theme already set on the HTML element (from server)
    this.currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    this.init();
  }

  init() {
    // Apply the theme that's already set (from server or default)
    this.applyTheme(this.currentTheme);
    
    // Theme toggle disabled - themes are managed through profile page
    // this.createToggleButton();
    
    // Add fade-in animation to body
    document.body.classList.add('fade-in');
    
    // Initialize Robert theme effects if applicable
    this.initRobertThemeEffects();
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
    
    // Initialize or clean up Robert theme effects
    this.initRobertThemeEffects();
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

  initRobertThemeEffects() {
    // Clean up existing intervals if any
    if (this.robertEffectInterval) {
      clearInterval(this.robertEffectInterval);
      this.robertEffectInterval = null;
    }

    // Clean up robert ambient sound timeout if any
    if (this.robertSoundTimeout) {
      clearTimeout(this.robertSoundTimeout);
      this.robertSoundTimeout = null;
    }
    
    // Clean up peak theme intervals if any
    if (this.peakEffectTimeout) {
      clearTimeout(this.peakEffectTimeout);
      this.peakEffectTimeout = null;
    }
    
    // Only run for robert theme
    if (this.currentTheme === 'robert') {
      this.startRobertEffects();
    }
    
    // Only run for peak (chickens memory) theme
    if (this.currentTheme === 'peak') {
      this.startPeakEffects();
    }
  }

  startRobertEffects() {
    const images = [
      '/img/shadow.png',
      '/img/eye.png',
      '/img/cronos.png',
      '/img/demon.png',
      '/img/shadowGuy.png'
    ];

    const spawnRandomImage = () => {
      // Random image from the array
      const randomImage = images[Math.floor(Math.random() * images.length)];
      
      // Random position on screen (avoiding edges)
      const randomX = Math.random() * 80 + 10; // 10% to 90%
      const randomY = Math.random() * 80 + 10; // 10% to 90%
      
      // Random size between 100px and 300px
      const randomSize = Math.floor(Math.random() * 200) + 100;
      
      // Create image element
      const imgElement = document.createElement('img');
      imgElement.src = randomImage;
      imgElement.className = 'robert-floating-image';
      imgElement.style.position = 'fixed';
      imgElement.style.left = `${randomX}%`;
      imgElement.style.top = `${randomY}%`;
      imgElement.style.width = `${randomSize}px`;
      imgElement.style.height = 'auto';
      imgElement.style.opacity = '0';
      imgElement.style.transition = 'opacity 2s ease-in-out';
      imgElement.style.pointerEvents = 'none';
      imgElement.style.zIndex = '9999';
      imgElement.style.transform = 'translate(-50%, -50%)';
      
      document.body.appendChild(imgElement);
      
      // Fade in
      setTimeout(() => {
        imgElement.style.opacity = '0.8';
      }, 100);
      
      // Linger duration: 8-15 seconds
      const lingerTime = Math.random() * 7000 + 8000;
      
      // Fade out and remove
      setTimeout(() => {
        imgElement.style.opacity = '0';
        setTimeout(() => {
          if (imgElement.parentNode) {
            imgElement.parentNode.removeChild(imgElement);
          }
        }, 2000); // Wait for fade out to complete
      }, lingerTime);
    };

    // Spawn first image immediately
    setTimeout(spawnRandomImage, 1000);
    
    // Spawn multiple images more frequently
    const spawnImages = () => {
      spawnRandomImage();
      // Schedule next spawn in 2-6 seconds
      setTimeout(spawnImages, Math.random() * 4000 + 2000);
    };
    
    // Start the spawning cycle
    setTimeout(spawnImages, 2000);

    // Ambient sounds: play "long wispers" or "schizo" rarely
    const robertSounds = [
      '/sfx/long wispers.wav',
      '/sfx/schizo.mp3'
    ];

    const playRandomRobertSound = () => {
      const sound = robertSounds[Math.floor(Math.random() * robertSounds.length)];
      const audio = new Audio(sound);
      audio.volume = 0.4;
      audio.play().catch(() => {}); // Ignore autoplay errors

      // Schedule next play in 60-180 seconds
      this.robertSoundTimeout = setTimeout(playRandomRobertSound, Math.random() * 120000 + 60000);
    };

    // Start first sound after 30-90 seconds
    this.robertSoundTimeout = setTimeout(playRandomRobertSound, Math.random() * 60000 + 30000);
  }

  startPeakEffects() {
    const spawnChickenSandwich = () => {
      // Random position on screen (avoiding edges)
      const randomX = Math.random() * 80 + 10; // 10% to 90%
      const randomY = Math.random() * 80 + 10; // 10% to 90%
      
      // Random size between 80px and 250px for variety
      const randomSize = Math.floor(Math.random() * 170) + 80;
      
      // Create image element
      const imgElement = document.createElement('img');
      imgElement.src = '/img/chickenSandwich.png';
      imgElement.className = 'peak-floating-sandwich';
      imgElement.style.position = 'fixed';
      imgElement.style.left = `${randomX}%`;
      imgElement.style.top = `${randomY}%`;
      imgElement.style.width = `${randomSize}px`;
      imgElement.style.height = 'auto';
      imgElement.style.opacity = '0';
      imgElement.style.transition = 'opacity 1.5s ease-in-out';
      imgElement.style.pointerEvents = 'none';
      imgElement.style.zIndex = '9999';
      imgElement.style.transform = 'translate(-50%, -50%)';
      
      document.body.appendChild(imgElement);
      
      // Fade in
      setTimeout(() => {
        imgElement.style.opacity = '0.85';
      }, 100);
      
      // Linger duration: 5-10 seconds
      const lingerTime = Math.random() * 5000 + 5000;
      
      // Fade out and remove
      setTimeout(() => {
        imgElement.style.opacity = '0';
        setTimeout(() => {
          if (imgElement.parentNode) {
            imgElement.parentNode.removeChild(imgElement);
          }
        }, 1500); // Wait for fade out to complete
      }, lingerTime);
    };

    // Spawn first sandwich immediately
    setTimeout(spawnChickenSandwich, 800);
    
    // Spawn multiple sandwiches frequently
    const spawnSandwiches = () => {
      spawnChickenSandwich();
      // Schedule next spawn in 1.5-4 seconds
      this.peakEffectTimeout = setTimeout(spawnSandwiches, Math.random() * 2500 + 1500);
    };
    
    // Start the spawning cycle
    setTimeout(spawnSandwiches, 1500);
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