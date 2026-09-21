"""Compare native Python results against frozen calls from legacy synthetic tests."""
import inspect
import json
import math
from pathlib import Path
import re

import pytest

from app.domain import structure, sentence, similarity, clause_role, formal, scope, tags, matching, evidence, history, agreement_evidence, presence

FIXTURE = Path(__file__).resolve().parents[2] / 'contracts/fixtures/legacy-domain.json'
MODULES = {'segmenter':structure, 'document_structure':structure, 'sentence':sentence,
           'clause_role':clause_role, 'formal':formal, 'scope_assessment':scope,
           'legal_constraints':scope, 'contract_tags':tags, 'evidence_rules':evidence, 'history_assist':history,
           'agreement_evidence':agreement_evidence, 'presence_profiles':presence}


def snake(name):
    return re.sub(r'(?<!^)(?=[A-Z])','_',name).lower()


def assert_same(actual, expected, path='result'):
    if type(expected) is float:
        assert type(actual) in (int,float) and math.isclose(actual,expected,rel_tol=1e-12,abs_tol=1e-12), path
    elif isinstance(expected,dict):
        assert isinstance(actual,dict) and actual.keys()==expected.keys(), (path, actual.keys(), expected.keys())
        for key in expected: assert_same(actual[key],expected[key],path+'.'+key)
    elif isinstance(expected,list):
        assert isinstance(actual,list) and len(actual)==len(expected), (path,len(actual),len(expected))
        for i,value in enumerate(expected): assert_same(actual[i],value,path+'['+str(i)+']')
    else:
        assert actual==expected and (type(expected) not in (bool,int) or (type(actual) is bool if type(expected) is bool else type(actual) in (int,float))), (path,actual,expected)


def prepared_cases():
    rows=json.loads(FIXTURE.read_text(encoding='utf-8'))['cases']
    synonyms=similarity.RULES['synonyms']
    for index,row in enumerate(rows):
        yield pytest.param(row,synonyms,id='%03d-%s-%s' % (index,row['module'],row['function']))
        if row['module']=='sim' and row['function']=='setSynonyms': synonyms=row['args'][0]


@pytest.mark.parametrize('row,synonyms',list(prepared_cases()))
def test_frozen_domain_call(row,synonyms):
    name=snake(row['function'])
    if row['module']=='matcher':
        fn=getattr(matching.Matcher(row.get('config')),name)
    elif row['module']=='sim':
        sim=similarity.Similarity(); sim.set_synonyms(synonyms)
        fn=getattr(sim,name,None) or getattr(similarity,name)
    else:
        if row['module']=='legal_constraints' and name=='assess': name='assess_legal'
        fn=getattr(MODULES[row['module']],name)
    args=row['args'][:len(inspect.signature(fn).parameters)]
    callbacks=list(row.get('callbacks') or [])
    if row['module']=='history_assist' and name=='rank_types':
        def classify(*input):
            callback=callbacks.pop(0)
            assert_same(list(input),callback['args'])
            return callback['result']
        args[3]=classify
    assert_same(fn(*args),row['result'])
    assert not callbacks
