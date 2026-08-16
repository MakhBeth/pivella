import React from 'react';
import Footer from './components/Footer';
import Home from './components/Home';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/dm-sans/700.css';
import '@fontsource/space-mono/400.css';
import '@fontsource/space-mono/700.css';
import styles from './App.module.css';

const App: React.FC = () => {
  return (
    <div className={styles.app}>
      <Home />
      <Footer />
    </div>
  );
};

export default App;
