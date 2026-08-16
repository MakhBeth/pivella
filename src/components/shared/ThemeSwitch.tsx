import { Sun, Moon, Monitor } from './icons';
import { useTheme } from '../../context/ThemeContext';

export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();

  const options: { value: 'light' | 'dark' | 'system'; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: 'Chiaro', icon: Sun },
    { value: 'dark', label: 'Scuro', icon: Moon },
    { value: 'system', label: 'Sistema', icon: Monitor },
  ];

  return (
    <div className="theme-switch">
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          className={`theme-switch-btn ${theme === value ? 'active' : ''}`}
          onClick={() => setTheme(value)}
          aria-pressed={theme === value}
        >
          <Icon size={16} aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
