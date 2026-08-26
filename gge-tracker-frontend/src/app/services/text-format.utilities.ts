/**
 * Inserts a comma every three digits of the integer part
 */
export const formatThousands = (value: number | string): string => {
  const text = typeof value === 'string' ? value : value.toString();
  const separatorIndex = text.indexOf('.');
  const integerPart = separatorIndex === -1 ? text : text.slice(0, separatorIndex);
  const fraction = separatorIndex === -1 ? '' : text.slice(separatorIndex);
  const sign = integerPart.startsWith('-') || integerPart.startsWith('+') ? integerPart[0] : '';
  const digits = sign ? integerPart.slice(1) : integerPart;
  for (const character of digits) {
    if (character < '0' || character > '9') return text;
  }
  let grouped = '';
  for (let end = digits.length; end > 0; end -= 3) {
    const chunk = digits.slice(Math.max(0, end - 3), end);
    grouped = grouped ? chunk + ',' + grouped : chunk;
  }
  return sign + grouped + fraction;
};

/**
 * Removes the digits a GGE server code ends with, so INT1 and INT2 both group under INT
 */
export const stripTrailingDigits = (text: string): string => {
  let end = text.length;
  while (end > 0 && text[end - 1] >= '0' && text[end - 1] <= '9') end--;
  return text.slice(0, end);
};
