"""Bounded subprocesses keep parser/CPU failures out of the shared API process."""
import json
import os
import subprocess
import sys
import threading

CAPACITY = threading.BoundedSemaphore(2)


class BusyError(Exception): pass


def execute(payload):
    if not CAPACITY.acquire(blocking=False):
        raise BusyError('다른 문서를 처리 중입니다. 잠시 후 다시 시도하세요.')
    try:
        env = {'PATH':os.environ.get('PATH',''),'PYTHONIOENCODING':'utf-8','PYTHONNOUSERSITE':'1',
               'PYTHONDONTWRITEBYTECODE':'1'}
        try:
            result = subprocess.run([sys.executable,'-m','app.worker'],input=json.dumps(payload,ensure_ascii=False),
                                    encoding='utf-8',capture_output=True,timeout=45,env=env)
        except subprocess.TimeoutExpired:
            raise BusyError('문서 처리 시간이 초과되었습니다. 문서를 나누어 다시 시도하세요.')
        if result.returncode != 0:
            raise ValueError('문서를 처리하지 못했습니다. 파일 형식과 문서 크기를 확인하세요.')
        value = json.loads(result.stdout)
        if 'error' in value: raise ValueError(value['error'])
        return value['result']
    finally:
        CAPACITY.release()
