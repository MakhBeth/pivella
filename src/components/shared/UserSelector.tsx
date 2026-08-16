import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Plus, User } from './icons';
import { useApp } from '../../context/AppContext';

interface UserSelectorProps {
  compact?: boolean;
}

export function UserSelector({ compact = false }: UserSelectorProps) {
  const { users, currentUser, switchUser, addUser, showToast } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setIsAddingUser(false);
        setNewUserName('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus input when adding user
  useEffect(() => {
    if (isAddingUser && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isAddingUser]);

  const handleAddUser = async () => {
    if (!newUserName.trim()) return;

    try {
      const newUser = await addUser(newUserName.trim());
      switchUser(newUser.id);
      setNewUserName('');
      setIsAddingUser(false);
      setIsOpen(false);
      showToast('Utente creato!');
    } catch (error) {
      showToast('Errore nella creazione utente', 'error');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddUser();
    } else if (e.key === 'Escape') {
      setIsAddingUser(false);
      setNewUserName('');
    }
  };

  // Hide if no user or only one user (no need to switch)
  if (!currentUser || users.length <= 1) {
    return null;
  }

  return (
    <div className={`user-selector ${compact ? 'user-selector-compact' : ''}`} ref={dropdownRef}>
      <button
        type="button"
        className="user-selector-trigger"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <User size={compact ? 16 : 18} aria-hidden="true" />
        <span className="user-selector-name">{currentUser.nome}</span>
        <ChevronDown size={16} className={`user-selector-chevron ${isOpen ? 'open' : ''}`} aria-hidden="true" />
      </button>

      {isOpen && (
        <div className="user-selector-dropdown" role="listbox" aria-label="Seleziona utente">
          {users.map(user => (
            <button
              key={user.id}
              type="button"
              className={`user-option ${user.id === currentUser.id ? 'active' : ''}`}
              onClick={() => {
                switchUser(user.id);
                setIsOpen(false);
              }}
              role="option"
              aria-selected={user.id === currentUser.id}
            >
              <User size={16} aria-hidden="true" />
              <span>{user.nome}</span>
            </button>
          ))}

          <div className="user-selector-divider" />

          {isAddingUser ? (
            <div className="user-add-form">
              <input
                ref={inputRef}
                type="text"
                className="user-add-input"
                placeholder="Nome utente..."
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleAddUser}
                disabled={!newUserName.trim()}
              >
                Aggiungi
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="user-option user-add-btn"
              onClick={() => setIsAddingUser(true)}
            >
              <Plus size={16} aria-hidden="true" />
              <span>Nuovo utente</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
