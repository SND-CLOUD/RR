import React, { useState, useEffect, useRef } from 'react';
import { Search, User, Phone, Check, Contact } from 'lucide-react';
import { Customer } from '../types';

export interface CustomerAutocompleteProps {
  customers: Customer[];
  onSelect?: (customer: Customer) => void;
  onSelectCustomer?: (customer: Customer) => void;
  onInputChange?: (value: string) => void;
  onChange?: (value: string) => void;
  onAddNew?: (name: string) => void;
  onPickContact?: () => void;
  isPickingContact?: boolean;
  placeholder?: string;
  label?: string;
  initialValue?: string;
  value?: string;
  type?: 'name' | 'phone';
}

export const CustomerAutocomplete: React.FC<CustomerAutocompleteProps> = ({
  customers,
  onSelect,
  onSelectCustomer,
  onInputChange,
  onChange,
  onAddNew,
  onPickContact,
  isPickingContact = false,
  placeholder = 'ابحث عن عميل...',
  label,
  initialValue = '',
  value,
  type = 'name'
}) => {
  const currentValue = value !== undefined ? value : initialValue;
  const [query, setQuery] = useState(currentValue);
  const [suggestions, setSuggestions] = useState<Customer[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(currentValue);
  }, [currentValue]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (typeof onInputChange === 'function') onInputChange(val);
    if (typeof onChange === 'function') onChange(val);

    if (val.trim().length > 0) {
      const filtered = (customers || []).filter(c => {
        const nameMatch = c.name && c.name.toLowerCase().includes(val.toLowerCase());
        const phoneMatch = (c.phone1 && c.phone1.includes(val)) || (c.phone2 && c.phone2.includes(val));
        return nameMatch || phoneMatch;
      }).slice(0, 5);
      setSuggestions(filtered);
      setIsOpen(true);
    } else {
      setSuggestions([]);
      setIsOpen(false);
    }
  };

  const handleSelect = (customer: Customer) => {
    setQuery(type === 'name' ? customer.name : customer.phone1);
    setIsOpen(false);
    if (typeof onSelect === 'function') {
      onSelect(customer);
    }
    if (typeof onSelectCustomer === 'function') {
      onSelectCustomer(customer);
    }
  };

  const handleAddNew = () => {
    if (typeof onAddNew === 'function') {
      onAddNew(query);
      setIsOpen(false);
    }
  };

  return (
    <div className="relative w-full" ref={wrapperRef}>
      {label && (
        <label className="text-[11px] font-bold text-gray-400 block mb-1 font-cairo">
          {label}
        </label>
      )}
      <div className="relative group">
        <input
          type={type === 'phone' ? 'tel' : 'text'}
          inputMode={type === 'phone' ? 'tel' : 'text'}
          value={query}
          onChange={(e) => {
            if (type === 'phone') {
              // Only allow numbers and common phone symbols
              const val = e.target.value.replace(/[^0-9+*#]/g, '');
              const event = { ...e, target: { ...e.target, value: val } } as React.ChangeEvent<HTMLInputElement>;
              handleInputChange(event);
            } else {
              handleInputChange(e);
            }
          }}
          onFocus={() => {
            if (query.trim().length > 0) setIsOpen(true);
          }}
          placeholder={placeholder}
          className={`w-full bg-black/40 border border-white/10 rounded-xl ${onPickContact ? 'pl-11 pr-4' : 'px-10'} py-2.5 focus:border-orange-500 outline-none transition-all text-sm font-bold text-white text-right font-cairo`}
        />
        {onPickContact ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onPickContact();
            }}
            disabled={isPickingContact}
            className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 bg-orange-600/15 hover:bg-orange-600/30 text-orange-400 hover:text-orange-300 rounded-lg border border-orange-500/25 transition-all flex items-center justify-center cursor-pointer active:scale-95 shadow-sm z-10 disabled:opacity-50"
            title="جلب الاسم والرقم من جهات اتصال الهاتف"
          >
            {isPickingContact ? (
              <span className="w-4 h-4 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <Contact size={16} />
            )}
          </button>
        ) : (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-orange-500 transition-colors pointer-events-none">
            {type === 'name' ? <User size={16} /> : <Phone size={16} />}
          </div>
        )}
      </div>

      {isOpen && (suggestions.length > 0 || onAddNew) && (
        <div className="absolute z-[100] w-full mt-1 bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          {suggestions.map((customer, cIdx) => (
            <button
              key={customer.id ? `sug-${customer.id}-${cIdx}` : `sug-idx-${cIdx}`}
              type="button"
              onClick={() => handleSelect(customer)}
              className="w-full px-4 py-3 text-right hover:bg-white/5 transition-colors border-b border-white/5 last:border-0 flex items-center justify-between group"
            >
              <div className="flex items-center gap-2 text-orange-500 opacity-0 group-hover:opacity-100 transition-opacity">
                <Check size={14} />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-bold text-white font-cairo">{customer.name}</span>
                <span className="text-[10px] text-gray-500 font-mono">{customer.phone1}</span>
              </div>
            </button>
          ))}
          {onAddNew && query.trim() !== '' && !suggestions.some(s => s.name === query.trim()) && (
            <button
              type="button"
              onClick={handleAddNew}
              className="w-full px-4 py-3 text-right bg-orange-600/10 hover:bg-orange-600/20 text-orange-500 transition-colors flex items-center justify-between group border-t border-white/5"
            >
              <span className="text-xs font-black font-cairo">+ إضافة "{query}" كعميل جديد</span>
              <User size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
