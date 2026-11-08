/** Mini-helpers de construction du DOM (pas de framework). */
type Child = Node | string | null | undefined | false;

export interface Props {
  class?: string;
  text?: string;
  attrs?: Record<string, string | number | boolean>;
  on?: Record<string, (e: Event) => void>;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  for (const [k, v] of Object.entries(props.attrs ?? {})) {
    // aria-* booléens (ex. aria-pressed) gardent leur valeur explicite "true"/"false".
    if (v === false && !k.startsWith('aria-')) continue;
    el.setAttribute(k, v === true && !k.startsWith('aria-') ? '' : String(v));
  }
  for (const [ev, fn] of Object.entries(props.on ?? {})) el.addEventListener(ev, fn);
  for (const c of children) if (c) el.append(c);
  return el;
}
