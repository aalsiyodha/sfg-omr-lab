/** Copy text from a user gesture; support mobile browsers without Clipboard API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall back for denied clipboard permission */ }
  const node = document.createElement('textarea');
  node.value = text;
  node.setAttribute('readonly', '');
  node.style.position = 'fixed';
  node.style.opacity = '0';
  node.style.left = '-9999px';
  document.body.appendChild(node);
  node.focus();
  node.select();
  try { return document.execCommand('copy'); }
  catch { return false; }
  finally { node.remove(); }
}
