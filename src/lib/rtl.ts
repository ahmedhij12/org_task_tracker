const ARABIC_RANGE = /[؀-ۿݐ-ݿ]/;

/** Right-aligns text that's mostly Arabic (checklist questions, template names), left-aligns everything else. */
export function textAlignFor(text: string): 'right' | 'left' {
  return ARABIC_RANGE.test(text) ? 'right' : 'left';
}
