import React from 'react';
import { Github } from './shared/icons';
import styles from './Footer.module.css';
import { version } from '../../package.json';

const Footer: React.FC = () => {
  return (
    <footer className={styles.footer}>
      <div className={styles.container}>
        <div className={styles.mobileInfo}>
          <div className={styles.credits}>
            Made by <a href="https://github.com/MakhBeth" target="_blank" rel="noopener noreferrer">MakhBeth</a>
          </div>
          <div className={styles.privacy}>
            🔒 All data stays local
          </div>
          <a href="https://github.com/MakhBeth/pivella" target="_blank" rel="noopener noreferrer" className={styles.githubLink}>
            <Github size={14} /> View on GitHub
          </a>
        </div>
        <div className={styles.right}>
          <span className={styles.version}>v{version}</span>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
