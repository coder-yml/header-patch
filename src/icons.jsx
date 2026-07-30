const Svg = ({ children, ...props }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    {children}
  </svg>
);

export const BrandIcon = () => <Svg strokeWidth="1.8"><path d="M4 7h16M4 12h10M4 17h16" /><circle cx="17.5" cy="12" r="2.5" fill="currentColor" stroke="none" /></Svg>;
export const CheckIcon = () => <Svg viewBox="0 0 16 16" strokeWidth="2"><path d="m3 8 3 3 7-7" /></Svg>;
export const RemoveIcon = (props) => <Svg {...props}><path d="M6 7h12M9 7V5h6v2M8 10v8M12 10v8M16 10v8M7 7l1 14h8l1-14" /></Svg>;
export const CopyIcon = () => <Svg><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></Svg>;
export const DragIcon = () => <Svg viewBox="0 0 16 16" fill="currentColor" stroke="none"><circle cx="5" cy="4" r="1" /><circle cx="11" cy="4" r="1" /><circle cx="5" cy="8" r="1" /><circle cx="11" cy="8" r="1" /><circle cx="5" cy="12" r="1" /><circle cx="11" cy="12" r="1" /></Svg>;
export const StackIcon = () => <Svg viewBox="0 0 16 16" strokeWidth="1.6"><path d="M4 3.5h8v8H4z" /><path d="M2.5 5.5v8h8" /></Svg>;
export const ChevronIcon = () => <Svg className="group-chevron" viewBox="0 0 16 16" strokeWidth="1.6"><path d="m4 6 4 4 4-4" /></Svg>;
export const AddIcon = () => <Svg strokeWidth="1.8"><path d="M12 5v14M5 12h14" /></Svg>;
export const ImportIcon = () => <Svg><path d="M12 5H5v14h7" /><path d="M20 12H9m0 0 3-3m-3 3 3 3" /></Svg>;
export const ExportIcon = () => <Svg><path d="M12 5h7v14h-7" /><path d="M4 12h11m0 0-3-3m3 3-3 3" /></Svg>;
export const CloseIcon = () => <Svg strokeWidth="1.8"><path d="m7 7 10 10M17 7 7 17" /></Svg>;
