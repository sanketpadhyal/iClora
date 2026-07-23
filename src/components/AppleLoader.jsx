import './AppleLoader.css';

const LOADER_BARS = Array.from({ length: 12 }, (_, index) => index + 1);

function AppleLoader({ className = '', size = 54, label = 'Loading', hidden = true }) {
  const style = { '--apple-loader-size': `${size}px` };
  const accessibilityProps = hidden
    ? { 'aria-hidden': 'true' }
    : { role: 'status', 'aria-label': label };

  return (
    <span className={`apple-loader ${className}`.trim()} style={style} {...accessibilityProps}>
      {LOADER_BARS.map((bar) => (
        <span key={bar} className={`apple-loader__bar apple-loader__bar--${bar}`} />
      ))}
    </span>
  );
}

export default AppleLoader;
