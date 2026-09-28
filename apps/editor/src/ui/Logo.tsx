// The tramme mark: a T whose bar is whole and whose stem is three frames, each
// a little further along and fainter, like images going by. Drawn in the
// accent colour of the theme.

export const LOGO_PATHS = `<rect x="2.5" y="2.6" width="19" height="5" rx="1.8"/><rect x="8.8" y="8.7" width="6.4" height="3.9" rx="1.2"/><rect x="9.9" y="13.7" width="6.4" height="3.9" rx="1.2" opacity=".66"/><rect x="11" y="18.7" width="6.4" height="3.9" rx="1.2" opacity=".36"/>`;

export function LogoMark({ size = 18 }: { size?: number }) {
  return <svg class="brand-mark" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" dangerouslySetInnerHTML={{ __html: LOGO_PATHS }} />;
}
