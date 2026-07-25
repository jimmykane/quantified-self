const theme = localStorage.getItem('appTheme');
const followsSystem = !theme || theme === 'System';
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
const shouldUseDarkTheme = theme === 'Dark' || (followsSystem && prefersDark);

document.body.classList.toggle('dark-theme', shouldUseDarkTheme);
