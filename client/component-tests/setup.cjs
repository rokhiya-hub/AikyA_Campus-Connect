global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
global.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
Object.defineProperty(window.SVGSVGElement.prototype, "createSVGRect", { configurable: true, value: () => ({}) });
Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 390 });
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 500 });
global.IS_REACT_ACT_ENVIRONMENT = true;
