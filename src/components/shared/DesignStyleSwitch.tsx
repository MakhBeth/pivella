import { useState, useEffect } from 'react';
import { Sparkles, Layers, Clock, Monitor, Gem } from 'lucide-react';

import '../../styles/prototypes/refined.css';
import '../../styles/prototypes/neomorphism.css';
import '../../styles/prototypes/windows95.css';
import '../../styles/prototypes/hynex.css';

export type DesignStyle = 'default' | 'hynex' | 'newage' | 'legacy' | 'windows95';

const DESIGN_STYLES: { value: DesignStyle; label: string; description: string; icon: typeof Sparkles }[] = [
  { value: 'hynex', label: 'Hynex', description: 'Dark glass, accenti teal', icon: Gem },
  { value: 'default', label: 'Default', description: 'Design raffinato', icon: Sparkles },
  { value: 'newage', label: 'New Age', description: 'Ombre morbide, effetto 3D', icon: Layers },
  { value: 'windows95', label: 'Windows 95', description: 'Retro, effetto 3D pixelato', icon: Monitor },
  { value: 'legacy', label: 'Legacy', description: 'Design originale', icon: Clock },
];

function applyDesignStyle(styleId: DesignStyle) {
  // Set data-design attribute on html element
  // 'legacy' means no data-design attribute (uses original theme.css only)
  if (styleId === 'legacy') {
    document.documentElement.removeAttribute('data-design');
  } else {
    document.documentElement.setAttribute('data-design', styleId);
  }
}

export function useDesignStyle() {
  const [designStyle, setDesignStyleState] = useState<DesignStyle>('hynex');

  useEffect(() => {
    // Migrate from old prototype switcher if present
    const oldKey = localStorage.getItem('style-prototype');
    if (oldKey) {
      localStorage.removeItem('style-prototype');
    }

    const saved = localStorage.getItem('design-style') as DesignStyle | null;
    if (saved && DESIGN_STYLES.some(s => s.value === saved)) {
      setDesignStyleState(saved);
      applyDesignStyle(saved);
    } else {
      // Default to 'hynex' on first load
      localStorage.setItem('design-style', 'hynex');
      applyDesignStyle('hynex');
    }
  }, []);

  const setDesignStyle = (style: DesignStyle) => {
    setDesignStyleState(style);
    localStorage.setItem('design-style', style);
    applyDesignStyle(style);
  };

  return { designStyle, setDesignStyle };
}

export function DesignStyleSwitch() {
  const { designStyle, setDesignStyle } = useDesignStyle();

  return (
    <div className="theme-switch" style={{ marginTop: 0 }}>
      {DESIGN_STYLES.map(({ value, label, description, icon: Icon }) => (
        <button
          key={value}
          type="button"
          className={`theme-switch-btn ${designStyle === value ? 'active' : ''}`}
          onClick={() => setDesignStyle(value)}
          aria-pressed={designStyle === value}
          style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4, padding: '12px 16px' }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon size={16} aria-hidden="true" />
            <span style={{ fontWeight: 600 }}>{label}</span>
          </span>
          <span style={{
            fontSize: '0.75rem',
            opacity: designStyle === value ? 0.9 : 0.7,
            fontWeight: 400
          }}>
            {description}
          </span>
        </button>
      ))}
    </div>
  );
}
