const fs = require('fs');
const file = 'src/components/PartsAutocomplete.tsx';
let code = fs.readFileSync(file, 'utf8');

// Modify PartsAutocomplete to prevent keyboard on first click on mobile
// We can use a readOnly state that toggles.

if (!code.includes('isReadOnly')) {
  code = code.replace(
    "const [isOpen, setIsOpen] = useState(false);",
    `const [isOpen, setIsOpen] = useState(false);
  const [isReadOnly, setIsReadOnly] = useState(true);
  
  // Reset readOnly when closed
  useEffect(() => {
    if (!isOpen) setIsReadOnly(true);
  }, [isOpen]);`
  );

  code = code.replace(
    /onFocus=\{\(\) => setIsOpen\(true\)\}/,
    `onFocus={(e) => {
      setIsOpen(true);
      // On mobile, keep readOnly true on first focus, but if they click again, allow typing
    }}
    onClick={(e) => {
      if (isReadOnly && isOpen) {
        setIsReadOnly(false);
        e.currentTarget.focus();
      }
    }}
    readOnly={isReadOnly}`
  );
  
  // also inject inputMode="text" maybe, but readOnly is sufficient.
}

fs.writeFileSync(file, code);
