"""Render inspectable service files without changing any system configuration."""
import argparse
import re
from pathlib import Path
from urllib.parse import urlsplit


def render(origin, output):
    url = urlsplit(origin)
    if (url.scheme != 'https' or not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?', url.netloc)
            or url.path or url.query or url.fragment or url.username or len(url.netloc) > 253):
        raise ValueError('Use an exact HTTPS origin without a path or custom port, e.g. https://contracts.example.internal')
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    source = Path(__file__).resolve().parent
    for name in ('contract-review-api.service', 'nginx.conf', 'contract-review.env'):
        text = (source / (name + '.in')).read_text(encoding='utf-8')
        text = text.replace('@ORIGIN@', origin).replace('@SERVER_NAME@', url.hostname)
        target = output / name
        target.write_text(text, encoding='utf-8')
        target.chmod(0o600 if name.endswith('.env') else 0o644)
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--origin', required=True)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    print(render(args.origin, args.output))
