"""Disposable CPU worker; no database, network, credentials, or JS runtime."""
import base64
import json
import sys


def main():
    if sys.platform.startswith('linux'):
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (1024*1024*1024, 1024*1024*1024))
        resource.setrlimit(resource.RLIMIT_CPU, (40, 40))
    payload = json.load(sys.stdin)
    try:
        if payload['task'] == 'extract':
            from app.domain.extraction import extract
            result = extract(payload['name'], base64.b64decode(payload['data'],validate=True))
        elif payload['task'] == 'analyse':
            from app.domain.review import analyse
            result = analyse(payload['text'], payload['documents'], payload['options'])
        else:
            raise ValueError('지원하지 않는 작업입니다.')
        print(json.dumps({'result':result},ensure_ascii=False))
    except ValueError as error:
        print(json.dumps({'error':str(error)},ensure_ascii=False))
    except Exception:
        print(json.dumps({'error':'문서를 처리하지 못했습니다. 파일 형식과 손상 여부를 확인하세요.'},ensure_ascii=False))


if __name__ == '__main__': main()
