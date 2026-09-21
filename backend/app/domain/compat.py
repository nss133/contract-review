"""Keep original text and JS UTF-16 identifiers during migration."""


def _units(text):
    raw = text.encode("utf-16-le", errors="surrogatepass")
    return [raw[i] + (raw[i + 1] << 8) for i in range(0, len(raw), 2)]


def legacy_hash(text):
    value = 5381
    for unit in _units(text):
        value = (value * 33 + unit) & 0xFFFFFFFF
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    result = ""
    while value:
        value, remainder = divmod(value, 36)
        result = digits[remainder] + result
    return "cr-" + (result or "0")


def utf16_offset(text, codepoint_index):
    if not 0 <= codepoint_index <= len(text):
        raise ValueError("Character position outside source")
    return len(_units(text[:codepoint_index]))


def codepoint_offset(text, utf16_index):
    count = 0
    for index, char in enumerate(text):
        if count == utf16_index:
            return index
        count += len(_units(char))
    if count == utf16_index:
        return len(text)
    raise ValueError("UTF-16 position outside source or inside a surrogate pair")
