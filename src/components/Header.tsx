import React from 'react';
import { Github } from './shared/icons';
import styles from './Header.module.css';

interface HeaderProps {
  title?: React.ReactNode;
}

// "Pivella" wordmark: P, iv and a stay bold, "ell" is lighter to highlight P.IVA
const defaultTitle = (
  <>
    Piv<span className={styles.logoLight}>ell</span>a
  </>
);

const Header: React.FC<HeaderProps> = ({ title = defaultTitle }) => {
  return (
    <header className={styles.header}>
      <div className={styles.container}>
        <div className={styles.logo}>
          <h1 className={styles.logoText}>{title}</h1>
          <p className={styles.logoSubtext}>Gestione P.IVA in forfettario</p>
        </div>
        <nav className={styles.nav}>
          <a 
            href="https://github.com/MakhBeth/pivella"
            target="_blank" 
            rel="noopener noreferrer"
            className={styles.githubLink}
            aria-label="View on GitHub"
          >
            <Github size={20} />
            <span>GitHub</span>
          </a>
        </nav>
      </div>
    </header>
  );
};

export default Header;
