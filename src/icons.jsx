const Svg = ({ children, ...props }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    {children}
  </svg>
);

export const BrandIcon = () => <Svg><path d="M4 7h16M4 12h10M4 17h16" /><circle cx="17.5" cy="12" r="2.5" fill="currentColor" stroke="none" /></Svg>;
export const CheckIcon = () => <Svg viewBox="0 0 16 16" strokeWidth="2"><path d="m3 8 3 3 7-7" /></Svg>;
export const RemoveIcon = () => <Svg><path d="M6 7h12M9 7V5h6v2M8 10v8M12 10v8M16 10v8M7 7l1 14h8l1-14" /></Svg>;
export const CopyIcon = () => <Svg><rect x="8" y="8" width="10" height="10" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></Svg>;
export const DragIcon = () => <Svg><circle cx="8" cy="7" r="1" fill="currentColor" stroke="none" /><circle cx="16" cy="7" r="1" fill="currentColor" stroke="none" /><circle cx="8" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="16" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="8" cy="17" r="1" fill="currentColor" stroke="none" /><circle cx="16" cy="17" r="1" fill="currentColor" stroke="none" /></Svg>;
export const StackIcon = () => <Svg viewBox="0 0 16 16"><rect x="2.5" y="2.5" width="8" height="8" rx="1.5" /><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /></Svg>;
export const ChevronIcon = () => <Svg viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" /></Svg>;
export const AddIcon = () => <Svg><path d="M12 5v14M5 12h14" /></Svg>;
export const ImportIcon = () => <Svg><path d="M4 5h8v4M4 19h8v-4M13 12H6M10 9l3 3-3 3M18 5v14" /></Svg>;
export const ExportIcon = () => <Svg><path d="M20 5h-8v4M20 19h-8v-4M11 12h7M14 9l-3 3 3 3M6 5v14" /></Svg>;
export const CloseIcon = () => <Svg><path d="m6 6 12 12M18 6 6 18" /></Svg>;
