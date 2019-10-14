// LICENSE_CODE ZON ISC
'use strict'; /*jslint node:true, mocha:true*/
const _ = require('lodash');
const nock = require('nock');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const request = require('request');
const sinon = require('sinon');
const Manager = require('../lib/manager.js');
const Server = require('../lib/server.js');
const cities = require('../lib/cities');
sinon.stub(cities, 'ensure_data', ()=>null);
const logger = require('../lib/logger.js');
const etask = require('../util/etask.js');
const pkg = require('../package.json');
const qw = require('../util/string.js').qw;
const lpm_util = require('../util/lpm_util.js');
const lpm_config = require('../util/lpm_config.js');
const assign = Object.assign;
const {stub: sstub, match: smatch} = sinon;
const customer = 'abc';
const password = 'xyz';
const {assert_has} = require('./common.js');
const api_base = 'https://'+pkg.api_domain;

logger.transports.forEach(t=>{ t.silent = true; });

let tmp_file_counter = 0;
const temp_file_path = (ext, pre)=>{
    const p = path.join(os.tmpdir(),
        `${pre||'test'}-${Date.now()}-${tmp_file_counter++}.${ext||'tmp'}`);
    const done = ()=>{
        if (this.path)
        {
            try {
                fs.unlinkSync(path);
            } catch(e){}
            this.path = null;
        }
    };
    return {path: p, done: done};
};

const temp_file = (content, ext, pre)=>{
    const temp = temp_file_path(ext, pre);
    fs.writeFileSync(temp.path, JSON.stringify(content));
    return temp;
};

describe('manager', ()=>{
    const logger_stub = sinon.stub(logger, 'notice');
    let app, temp_files;
    const get_param = (args, param)=>{
        let i = args.indexOf(param)+1;
        return i ? args[i] : null;
    };
    const app_with_args = (args, only_explicit)=>etask(function*(){
        let manager;
        this.finally(()=>{
            if (this.error && manager)
                return manager.stop(true);
        });
        args = args||[];
        if (!only_explicit)
        {
            let log = get_param(args, '--log');
            if (!log)
                args = args.concat(['--log', 'NONE']);
            if (!get_param(args, '--proxy'))
                args = args.concat(['--proxy', '127.0.0.1']);
            if (!get_param(args, '--proxy_port'))
                args = args.concat(['--proxy_port', 24000]);
            if (!get_param(args, '--config')&&!get_param(args, '--no-config'))
                args.push('--no-config');
            if (!get_param(args, '--customer'))
                args = args.concat(['--customer', customer]);
            if (!get_param(args, '--password'))
                args = args.concat(['--password', password]);
            if (!get_param(args, '--dropin'))
                args = args.concat(['--no-dropin']);
            if (!get_param(args, '--cookie')&&!get_param(args, '--no-cookie'))
                args.push('--no-cookie');
            if (!get_param(args, '--local_login'))
                args = args.concat(['--no-local_login']);
            args = args.concat('--loki', '/tmp/testdb');
        }
        Manager.prototype.get_ip = ()=>null;
        Manager.prototype.check_conn = ()=>null;
        manager = new Manager(lpm_util.init_args(args));
        yield manager.start();
        return {manager};
    });
    const app_with_config = opt=>etask(function*(){
        const args = [];
        const cli = opt.cli||{};
        Object.keys(cli).forEach(k=>{
            if (typeof cli[k]=='boolean')
            {
                if (cli[k])
                    args.push('--'+k);
                else
                    args.push('--no-'+k);
                return;
            }
            args.push('--'+k);
            if (Array.isArray(cli[k]))
                args.push(...cli[k]);
            else
                args.push(cli[k]);
        });
        if (opt.config)
        {
            const config_file = temp_file(opt.config||[], 'json');
            args.push('--config');
            args.push(config_file.path);
            temp_files.push(config_file);
        }
        (opt.files||[]).forEach(c=>{
            const file = temp_file(c, 'json');
            args.push(file.path);
            temp_files.push(file);
        });
        return yield app_with_args(args, opt.only_explicit);
    });
    const app_with_proxies = (proxies, cli)=>etask(function*(){
        return yield app_with_config({config: {proxies}, cli});
    });
    const api = (_path, method, data, json, headers)=>etask(function*(){
        const admin = 'http://127.0.0.1:'+Manager.default.www;
        const opt = {
            url: admin+'/'+_path,
            method: method||'GET',
            json: json,
            body: data,
            headers: headers || {'x-lpm-fake': true},
        };
        return yield etask.nfn_apply(request, [opt]);
    });
    const api_json = (_path, opt={})=>etask(function*(){
        return yield api(_path, opt.method, opt.body, true, opt.headers);
    });
    const json = (_path, method, data)=>etask(function*(){
        const res = yield api(_path, method, data, true);
        assert.equal(res.statusCode, 200);
        return res.body;
    });
    const make_user_req = (port=24000, status=200)=>{
        return api_json('api/test/'+port, {
            method: 'POST',
            body: {
                url: 'http://lumtest.com/myip.json',
                headers: {'x-lpm-fake': true, 'x-lpm-fake-status': status},
            },
        });
    };
    afterEach('after manager', etask._fn(function*(_this){
        if (!app)
            return;
        yield app.manager.stop(true);
        if (process.platform=='win32')
            yield etask.sleep(10);
        if (!app)
            return;
        app = null;
    }));
    beforeEach(()=>{
        temp_files = [];
    });
    afterEach('after manager 2', ()=>{
        temp_files.forEach(f=>f.done());
    });
    describe('get_params', ()=>{
        const t = (name, _args, expected)=>it(name, etask._fn(function(_this){
            const mgr = new Manager(lpm_util.init_args(_args));
            assert.deepEqual(expected, mgr.get_params());
        }));
        t('default', qw`--foo 1 --bar 2`, ['--foo', 1, '--bar', 2]);
        t('credentials',
            qw`--foo 1 --bar 2 --customer test_user --password abcdefgh`,
            ['--foo', 1, '--bar', 2]);
        t('credentials with no-config',
            qw`--no-config --customer usr --password abc --token t --zone z`,
            qw`--no-config --customer usr --password abc --token t --zone z`);
    });
    describe('config load', ()=>{
        const t = (name, config, expected)=>it(name, etask._fn(
        function*(_this){
            _this.timeout(6000);
            app = yield app_with_config(config);
            const proxies = yield json('api/proxies_running');
            assert_has(proxies, expected, 'proxies');
        }));
        const simple_proxy = {port: 24024};
        t('cli only', {cli: simple_proxy, config: []},
            [assign({}, simple_proxy, {proxy_type: 'persist'})]);
        t('main config only', {config: simple_proxy},
            [assign({}, simple_proxy, {proxy_type: 'persist'})]);
        t('config file', {config: {proxies: [simple_proxy]}}, [simple_proxy]);
        t('config override cli', {cli: simple_proxy, config: {port: 24042}},
            [simple_proxy, {proxy_type: 'persist', port: 24042}]);
        describe('default zone', ()=>{
            const zone_static = {password: ['pass1']};
            const zone_gen = {password: ['pass2']};
            const zones = {static: Object.assign({}, zone_static),
                gen: assign({}, zone_gen)};
            const t2 = (name, config, expected, _defaults={zone: 'static'})=>{
                nock(api_base).get('/').reply(200, {});
                nock(api_base).post('/update_lpm_stats').reply(200, {});
                nock(api_base).get('/cp/lum_local_conf')
                    .query({customer: 'testc1', proxy: pkg.version})
                    .reply(200, {_defaults});
                t(name, _.set(config, 'cli.customer', 'testc1'), expected);
            };
            t2('from defaults', {
                config: {_defaults: {zone: 'foo'}, proxies: [simple_proxy]},
            }, [Object.assign({zone: 'foo'}, simple_proxy)],
                {zone: 'static', zones});
            t2('keep default', {
                config: {_defaults: {zone: 'gen'}, proxies: [simple_proxy]},
            }, [Object.assign({zone: 'gen'}, simple_proxy)]);
            t2('empty zone should be overriden by default', {config: {
                _defaults: {},
                proxies: [Object.assign({zone: ''}, simple_proxy)],
            }}, [{zone: 'static'}]);
        });
        describe('args as default params for proxy ports', ()=>{
            it('should use proxy from args', etask._fn(function*(_this){
                app = yield app_with_args(['--proxy', '1.2.3.4',
                    '--proxy_port', '3939', '--dropin']);
                const dropin = app.manager.proxy_ports[22225];
                assert.equal(dropin.opt.proxy, '1.2.3.4');
                assert.equal(dropin.opt.proxy_port, 3939);
            }));
        });
    });
    describe('dropin', ()=>{
        it('off', etask._fn(function*(_this){
            app = yield app_with_args(['--no-dropin']);
            assert.ok(!app.manager.proxy_ports[22225]);
        }));
        it('on', etask._fn(function*(_this){
            app = yield app_with_args(['--dropin']);
            assert.ok(!!app.manager.proxy_ports[22225]);
        }));
    });
    describe('api', ()=>{
        it('ssl', etask._fn(function*(_this){
            app = yield app_with_args();
            const res = yield api('ssl');
            assert_has(res.headers, {
                'content-type': 'application/x-x509-ca-cert',
                'content-disposition': 'filename=luminati.crt',
            }, 'headers');
            assert.equal(res.body, fs.readFileSync(path.join(__dirname,
                '../bin/ca.crt')), 'certificate');
        }));
        describe('version info', ()=>{
            it('current', ()=>etask(function*(){
                app = yield app_with_args();
                const body = yield json('api/version');
                assert.equal(body.version, pkg.version);
            }));
        });
        describe('proxies', ()=>{
            describe('get', ()=>{
                it('normal', ()=>etask._fn(function*(_this){
                    const proxies = [{port: 24023}, {port: 24024}];
                    app = yield app_with_proxies(proxies);
                    let res = yield json('api/proxies');
                    assert_has(res, proxies, 'proxies');
                    res = yield json('api/proxies_running');
                    assert_has(res, proxies, 'proxies_running');
                }));
            });
            describe('post', ()=>{
                it('normal non-persist', ()=>etask._fn(function*(_this){
                    const sample_proxy = {
                        port: 24001,
                        proxy_type: 'non-persist',
                    };
                    const proxies = [{port: 24000}];
                    app = yield app_with_proxies(proxies, {});
                    let res = yield json('api/proxies', 'post',
                        {proxy: sample_proxy});
                    assert_has(res, {data: sample_proxy}, 'proxies');
                    res = yield json('api/proxies_running');
                    assert_has(res, [{}, sample_proxy], 'proxies');
                    res = yield json('api/proxies');
                    assert.equal(res.length, 1);
                }));
                it('normal persist', etask._fn(function*(_this){
                    let sample_proxy = {port: 24001};
                    let proxies = [{port: 24000}];
                    app = yield app_with_proxies(proxies, {});
                    let res = yield json('api/proxies', 'post',
                        {proxy: sample_proxy});
                    assert_has(res, {data: sample_proxy}, 'proxies');
                    res = yield json('api/proxies_running');
                    assert_has(res, [{}, sample_proxy], 'proxies');
                    res = yield json('api/proxies');
                    assert_has(res, [{}, sample_proxy], 'proxies');
                }));
                it('inherit defaults', ()=>etask(function*(){
                    const sample_proxy = {port: 24001, proxy_type:
                        'non-persist'};
                    const res_proxy = assign({}, {customer, password},
                        sample_proxy);
                    app = yield app_with_proxies([{port: 24000}], {});
                    let res = yield json('api/proxies', 'post',
                        {proxy: sample_proxy});
                    assert_has(res, {data: res_proxy}, 'proxies');
                    res = yield json('api/proxies_running');
                    assert_has(res, [{}, res_proxy], 'proxies');
                    res = yield json('api/proxies');
                    assert.equal(res.length, 1);
                }));
                it('conflict', etask._fn(function*(_this){
                    const sample_proxy = {port: 24000};
                    const proxies = [sample_proxy];
                    app = yield app_with_proxies(proxies, {});
                    const res = yield api_json('api/proxies',
                        {method: 'post', body: {proxy: sample_proxy}});
                    assert.equal(res.statusCode, 400);
                    assert_has(res.body, {errors: []}, 'proxies');
                }));
            });
            describe('put', ()=>{
                it('normal', etask._fn(function*(_this){
                    const put_proxy = {port: 24001};
                    const proxies = [{port: 24000}];
                    app = yield app_with_proxies(proxies, {});
                    let res = yield json('api/proxies/24000', 'put',
                        {proxy: put_proxy});
                    assert_has(res, {data: put_proxy});
                    res = yield json('api/proxies_running');
                    assert_has(res, [put_proxy], 'proxies');
                }));
                it('inherit defaults', ()=>etask(function*(){
                    const put_proxy = {port: 24001};
                    const proxies = [{port: 24000}];
                    const res_proxy = assign({}, {customer, password},
                        put_proxy);
                    app = yield app_with_proxies(proxies, {});
                    let res = yield json('api/proxies/24000', 'put',
                        {proxy: put_proxy});
                    assert_has(res, {data: res_proxy});
                    res = yield json('api/proxies_running');
                    assert_has(res, [res_proxy], 'proxies');
                }));
                it('conflict', etask._fn(function*(_this){
                    let proxies = [{port: 24000}, {port: 24001}];
                    app = yield app_with_proxies(proxies, {});
                    let res = yield api_json('api/proxies/24001',
                        {method: 'put', body: {proxy: {port: 24000}}});
                    assert.equal(res.statusCode, 400);
                    assert_has(res.body, {errors: []}, 'proxies');
                }));
            });
            describe('delete', ()=>{
                it('normal', etask._fn(function*(_this){
                    app = yield app_with_args([]);
                    let res = yield api_json('api/proxies/24000',
                        {method: 'delete'});
                    assert.equal(res.statusCode, 204);
                }));
            });
        });
        describe('banips', ()=>{
            it('should fail when any IP fails', ()=>etask(function*(_this){
                const proxies = [{port: 24000}];
                app = yield app_with_proxies(proxies, {});
                sinon.stub(Server.prototype, 'banip', ip=>ip=='1.1.1.2');
                const res = yield api_json('api/proxies/24000/banips',
                    {method: 'post', body: {ips: ['1.1.1.1', '1.1.1.2']}});
                Server.prototype.banip.restore();
                assert.equal(res.statusCode, 400);
            }));
        });
        describe('user credentials', ()=>{
            it('success', etask._fn(function*(_this){
                nock(api_base).get('/').times(3).reply(200, {});
                nock(api_base).post('/update_lpm_stats').reply(200, {});
                nock(api_base).post('/update_lpm_config').reply(200, {});
                nock(api_base).get('/cp/lum_local_conf').query(true)
                    .reply(200, {mock_result: true, _defaults: true});
                app = yield app_with_args(['--customer', 'mock_user']);
                const res = yield app.manager.get_lum_local_conf(null, '123');
                assert_has(res, {mock_result: true});
            }));
            it('login required', etask._fn(function*(_this){
                nock(api_base).get('/').times(3).reply(200, {});
                nock(api_base).get('/cp/lum_local_conf')
                    .query(true)
                    .reply(403, 'login_required');
                nock(api_base).get('/cp/lum_local_conf').times(2)
                    .query(true)
                    .reply(403, 'login_required');
                app = yield app_with_args(['--customer', 'mock_user']);
                try {
                    yield app.manager.get_lum_local_conf(null, '123');
                    assert.fail('should have thrown exception');
                } catch(e){
                    assert_has(e, {status: 403, message: 'login_required'});
                }
            }));
        });
        describe('har logs', ()=>{
            it('fetches all the logs', etask._fn(function*(_this){
                app = yield app_with_args(['--customer', 'mock_user',
                    '--port', '24000']);
                app.manager.loki.requests_clear();
                app.manager.proxy_ports[24000].emit('usage', {
                    timeline: null,
                    url: 'http://bbc.com',
                    request: {url: 'http://bbc.com'},
                    response: {},
                });
                const res = yield api_json(`api/logs_har`);
                assert_has(res.body.log.entries[0],
                    {request: {url: 'http://bbc.com'}});
                assert.equal(res.body.log.entries.length, 1);
            }));
        });
        describe('add_wip', ()=>{
            it('forbidden when token is not set', etask._fn(function*(_this){
                app = yield app_with_config({config: {}});
                const res = yield api_json('api/add_wip', {
                    method: 'POST',
                    headers: {Authorization: 'aaa'},
                });
                assert.equal(res.statusMessage, 'Forbidden');
                assert.equal(res.statusCode, 403);
            }));
            it('forbidden when token is not correct',
            etask._fn(function*(_this){
                const config = {_defaults: {token_auth: 'aaa'}};
                app = yield app_with_config({config});
                const res = yield api_json('api/add_wip', {method: 'POST'});
                assert.equal(res.statusMessage, 'Forbidden');
                assert.equal(res.statusCode, 403);
            }));
            it('bad requests if no IP is passed', etask._fn(function*(_this){
                const config = {_defaults: {token_auth: 'aaa'}};
                app = yield app_with_config({config});
                const res = yield api_json('api/add_wip', {
                    method: 'POST',
                    headers: {Authorization: 'aaa'},
                });
                assert.equal(res.statusMessage, 'Bad Request');
                assert.equal(res.statusCode, 400);
            }));
            it('adds IP without a mask', etask._fn(function*(_this){
                const config = {_defaults: {token_auth: 'aaa'}};
                app = yield app_with_config({config});
                const res = yield api_json('api/add_wip', {
                    method: 'POST',
                    headers: {Authorization: 'aaa'},
                    body: {ip: '1.1.1.1'},
                });
                assert.equal(res.statusCode, 200);
                assert.equal(app.manager._defaults.whitelist_ips.length, 1);
                assert.equal(app.manager._defaults.whitelist_ips[0],
                    '1.1.1.1');
            }));
            it('adds IP with a mask', etask._fn(function*(_this){
                const config = {_defaults: {token_auth: 'aaa'}};
                app = yield app_with_config({config});
                const res = yield api_json('api/add_wip', {
                    method: 'POST',
                    headers: {Authorization: 'aaa'},
                    body: {ip: '1.1.1.1/20'},
                });
                assert.equal(res.statusCode, 200);
                assert.equal(app.manager._defaults.whitelist_ips.length, 1);
                assert.equal(app.manager._defaults.whitelist_ips[0],
                    '1.1.0.0/20');
            }));
        });
    });
    xdescribe('crash on load error', ()=>{
        beforeEach(()=>{
            logger_stub.reset();
        });
        const t = (name, proxies, msg)=>it(name, etask._fn(function*(_this){
            const err_matcher = sinon.match(msg);
            app = yield app_with_proxies(proxies);
            sinon.assert.calledWith(logger_stub, err_matcher);
        }));
        t('conflict proxy port', [{port: 24024}, {port: 24024}],
            'Port %s is already in use by #%s - skipped');
        const www_port = Manager.default.www;
        t('conflict with www', [{port: www_port}],
            `Port %s is already in use by %s - skipped`);
    });
    describe('using passwords', ()=>{
        it('take password from provided zone', etask._fn(function*(_this){
            const config = {proxies: []};
            const _defaults = {zone: 'static', password: 'xyz',
                zones: {zone1: {password: ['zone1_pass']}}};
            nock(api_base).get('/cp/lum_local_conf').query(true)
                .reply(200, {_defaults});
            nock(api_base).post('/update_lpm_stats').query(true)
                .reply(200, {});
            nock(api_base).post('/update_lpm_config').query(true)
                .reply(200, {});
            app = yield app_with_config({config, cli: {token: '123'}});
            const res = yield json('api/proxies', 'post',
                {proxy: {port: 24000, zone: 'zone1'}});
            assert.equal(res.data.password, 'zone1_pass');
        }));
        it('uses password from default zone', etask._fn(function*(_this){
            const config = {proxies: []};
            const _defaults = {zone: 'static', password: 'xyz',
                zones: {static: {password: ['static_pass']}}};
            nock(api_base).get('/').times(3).reply(200, {});
            nock(api_base).get('/cp/lum_local_conf').query(true)
                .reply(200, {_defaults});
            nock(api_base).post('/update_lpm_stats').query(true)
                .reply(200, {});
            nock(api_base).post('/update_lpm_config').query(true)
                .reply(200, {});
            app = yield app_with_config({config, cli: {token: '123'}});
            const res = yield json('api/proxies', 'post',
                {proxy: {port: 24000, zone: 'static'}});
            assert.equal(res.data.password, 'static_pass');
        }));
        it('uses new proxy custom password', etask._fn(function*(_this){
            const config = {proxies: []};
            const _defaults = {zone: 'static', password: 'xyz',
                zones: {static: {password: ['static_pass']}}};
            app = yield app_with_config({config, cli: {}});
            nock(api_base).get('/cp/lum_local_conf')
            .query({customer: 'abc', proxy: pkg.version, token: ''})
            .reply(200, {_defaults});
            const res = yield json('api/proxies', 'post',
                {proxy: {port: 24000, zone: 'static', password: 'p1_pass'}});
            assert.equal(res.data.password, 'p1_pass');
        }));
        it('uses existing proxy custom password', etask._fn(function*(_this){
            const _defaults = {
                zone: 'static',
                password: 'xyz',
                zones: {
                    static: {password: ['static_pass']},
                    zone2: {password: ['zone2_pass']},
                },
            };
            nock(api_base).get('/').times(3).reply(200, {});
            nock(api_base).get('/cp/lum_local_conf').query(true)
                .reply(200, {_defaults});
            nock(api_base).post('/update_lpm_stats').query(true)
                .reply(200, {});
            nock(api_base).post('/update_lpm_config').query(true)
                .reply(200, {});
            const config = {proxies: [
                {port: 24000, zone: 'static', password: 'p1_pass'},
                {port: 24001, zone: 'zone2', password: 'p2_pass'},
                {port: 24002, zone: 'static'},
                {port: 24003, zone: 'zone2'},
                {port: 24004},
                {port: 24005, zone: 'unknown', password: 'p3_pass'},
            ]};
            app = yield app_with_config({config, cli: {token: '123'}});
            const res = yield json('api/proxies_running');
            assert.equal(res.find(p=>p.port==24000).password, 'static_pass');
            assert.equal(res.find(p=>p.port==24001).password, 'zone2_pass');
            assert.equal(res.find(p=>p.port==24002).password, 'static_pass');
            assert.equal(res.find(p=>p.port==24003).password, 'zone2_pass');
            assert.equal(res.find(p=>p.port==24004).password, 'static_pass');
            assert.equal(res.find(p=>p.port==24005).password, 'p3_pass');
        }));
    });
    describe('flags', ()=>{
        it('exits immediately with version on -v', etask._fn(function*(_this){
            const exec = require('child_process').execFile;
            exec('node', ['./bin/index.js', '--version'], (err, res)=>{
                this.continue();
                assert.equal(res, pkg.version+'\n');
            });
            yield this.wait();
        }));
    });
    describe('whitelisting', ()=>{
        const t = (name, proxies, default_calls, wh, cli)=>
        it(name, etask._fn(function*(_this){
            const port = proxies[0].port;
            app = yield app_with_proxies(proxies, cli);
            for (const c of default_calls)
                app.manager.set_whitelist_ips(c);
            const {whitelist_ips} = app.manager.proxy_ports[port].opt;
            assert.deepEqual(whitelist_ips, wh);
            const res = yield make_user_req();
            const whitelists = res.body.response.headers.find(
                h=>h.name=='x-lpm-whitelist');
            assert.ok(!!whitelists);
            assert.equal(whitelists.value, wh.join(' '));
        }));
        const p = [{port: 24000}];
        const p_w = [{port: 24000, whitelist_ips: ['1.1.1.1']}];
        const w_cli = {whitelist_ips: ['1.2.3.4', '4.3.2.1']};
        t('sets from cmd', p, [], ['1.2.3.4', '4.3.2.1'], w_cli);
        t('sets default', p, [['2.2.2.2']], ['2.2.2.2']);
        t('sets specific', p_w, [], ['1.1.1.1']);
        t('sets cmd and default', p, [['2.2.2.2']],
            ['1.2.3.4', '4.3.2.1', '2.2.2.2'], w_cli);
        t('sets cmd and specific', p_w, [], ['1.2.3.4', '4.3.2.1', '1.1.1.1'],
            w_cli);
        t('sets default and specific', p_w, [['2.2.2.2']],
            ['2.2.2.2', '1.1.1.1']);
        t('sets cmd, default and specific', p_w, [['2.2.2.2']],
            ['1.2.3.4', '4.3.2.1', '2.2.2.2', '1.1.1.1'], w_cli);
        t('removes IPs from proxy port config when removed in default ', p_w,
            [['2.2.2.2', '3.3.3.3'], []], ['1.2.3.4', '4.3.2.1', '1.1.1.1'],
            w_cli);
        it('updates proxy', ()=>etask(function*(){
            app = yield app_with_proxies(p);
            const whitelist_ips = ['1.1.1.1', '2.2.2.2', '3.0.0.0/8'];
            const new_proxy = Object.assign({}, p[0], {whitelist_ips});
            const opt = yield app.manager.proxy_update(p[0], new_proxy);
            assert.deepEqual(opt.whitelist_ips, whitelist_ips);
        }));
        it('should not save default/cmd whitelist', ()=>etask(function*(){
            const def = ['3.3.3.3', '4.4.4.4'], expected = ['7.8.9.10'];
            const proxies = [{port: 24000, whitelist_ips:
                w_cli.whitelist_ips.concat(def).concat(expected)}];
            app = yield app_with_proxies(proxies, w_cli);
            const m = app.manager;
            m.set_whitelist_ips(def);
            const s = m.config.serialize(m.proxies, m._defaults);
            const config = JSON.parse(s);
            const proxy = config.proxies[0];
            assert.equal(proxy.port, proxies[0].port);
            assert.deepEqual(proxy.whitelist_ips, expected);
    }));
    });
    xdescribe('migrating', ()=>{
        beforeEach(()=>{
            logger_stub.reset();
        });
        const t = (name, should_run_migrations, config={}, cli={})=>
        it(name, etask._fn(function*(_this){
            const notice = 'NOTICE: Migrating config file 1.116.387';
            const first_migration_match = sinon.match(notice);
            app = yield app_with_config({config, cli});
            if (should_run_migrations)
                sinon.assert.calledWith(logger_stub, first_migration_match);
            else
            {
                sinon.assert.neverCalledWith(logger_stub,
                    first_migration_match);
            }
        }));
        t('should run migrations if config file exists and version is old',
            true, {proxies: [{}]});
        t('should not run migrations if --no-config flag is passed',
            false, {proxies: [{}]}, {'no-config': true});
        t('should not run migrations if config does not exist', false);
        t('should not run migrations if config exists and version is new',
            false, {_defaults: {version: '1.120.0'}});
    });
    describe('first actions', ()=>{
        const filepath = path.join(os.tmpdir(), 'first_actions.json');
        const rm_actions_file = ()=>{
            if (fs.existsSync(filepath))
                fs.unlinkSync(filepath);
        };
        let perr_stub;
        before(()=>lpm_config.first_actions = filepath);
        after(()=>nock.cleanAll());
        beforeEach(()=>{
            nock(api_base).get('/').reply(200, {}).persist();
            ['/update_lpm_stats', '/update_lpm_config'].forEach(p=>
                nock(api_base).post(p).query(true).reply(200, {}).persist());
            rm_actions_file();
            perr_stub = sstub(Manager.prototype, 'perr');
        });
        afterEach(()=>{
            rm_actions_file();
            perr_stub.restore();
        });
        const m = a=>smatch(`first_${a}`);
        const perr_called_n_times_with = (a, n)=>{
            const event = `first_${a}`;
            const calls = perr_stub.getCalls().filter(c=>c.args[0]==event);
            assert.equal(calls.length, n);
        };
        const t = (name, called, action, config, conf_success=true)=>
        it(name, etask._fn(function*(_this){
            const i = nock(api_base).get('/cp/lum_local_conf').query(true);
            if (conf_success)
                i.reply(200, {mock_result: true, _defaults: true});
            else
                i.reply(403);
            app = yield app_with_config({config, cli: {token: '123'}});
            if (called)
                sinon.assert.calledWith(perr_stub, m(action));
            else
                sinon.assert.neverCalledWith(perr_stub, m(action));
        }));
        t('triggers login on startup if logged', true, 'login');
        t('does not triggers login on startup if not logged', false, 'login',
            null, false);
        t('triggers create_proxy_port on startup if custom port created', true,
            'create_proxy_port', {proxies: [{port: 24023}, {port: 24024}]});
        t('does not trigger create_proxy_port on startup if no custom ports',
            false, 'create_proxy_port');
        t('never triggers send_request on startup', false, 'send_request');
        t('never triggers send_request_successful on startup', false,
            'send_request_successful');
        it('maintains actions object structure when file does not exist',
        etask._fn(function*(_this){
            nock(api_base).get('/cp/lum_local_conf').query(true)
                .reply(200, {mock_result: true, _defaults: true});
            app = yield app_with_config({cli: {token: '123'}});
            sinon.assert.match(app.manager.first_actions,
                smatch({sent: {}, sending: {}, pending: []}));
        }));
        it('maintains actions object structure when file is missing fields',
        etask._fn(function*(_this){
            nock(api_base).get('/cp/lum_local_conf').query(true)
                .reply(200, {mock_result: true, _defaults: true});
            fs.writeFileSync(lpm_config.first_actions, JSON.stringify({}));
            app = yield app_with_config({cli: {token: '123'}});
            sinon.assert.match(app.manager.first_actions,
                smatch({sent: {}, sending: {}, pending: []}));
        }));
        it('does not trigger actions on zone password authentication',
        etask._fn(function*(_this){
            nock(api_base).get('/cp/lum_local_conf').query(true).reply(403);
            app = yield app_with_config({config: {proxies: [{port: 24010}]},
                cli: {customer: false, token: '123'}});
            yield make_user_req(24010);
            sinon.assert.neverCalledWith(perr_stub, smatch('first'));
        }));
        it('triggers create_proxy_port_def when using dropin',
        etask._fn(function*(_this){
            nock(api_base).get('/cp/lum_local_conf').query(true)
                .reply(200, {mock_result: true, _defaults: true});
            app = yield app_with_config({cli: {token: '123', dropin: true}});
            yield make_user_req(22225);
            const matches = ['login', 'create_proxy_port_def', 'send_request',
                'send_request_successful'].map(m);
            matches.forEach(_m=>sinon.assert.calledWith(perr_stub, _m));
            sinon.assert.neverCalledWith(perr_stub,
                smatch(/^first_create_proxy_port$/));
        }));
        it('triggers failed actions after error has happened',
        etask._fn(function*(_this){
            nock(api_base).get('/cp/lum_local_conf').query(true)
                .reply(200, {mock_result: true, _defaults: true});
            perr_stub.returns(etask.reject(Error('Network error')));
            app = yield app_with_config({cli: {token: '123', dropin: true}});
            yield make_user_req(22225);
            perr_stub.resetBehavior();
            yield make_user_req(22225);
            // called 3 times due to logged_update and retry on mgr.start
            perr_called_n_times_with('login', 3);
            perr_called_n_times_with('create_proxy_port_def', 2);
            perr_called_n_times_with('send_request', 2);
            perr_called_n_times_with('send_request_successful', 2);
        }));
        it('stops retrying if action has already been retried',
        etask._fn(function*(_this){
            nock(api_base).get('/cp/lum_local_conf').query(true)
                .reply(200, {mock_result: true, _defaults: true});
            perr_stub.restore();
            perr_stub = sstub(Manager.prototype, 'perr', id=>{
                if (!id.startsWith('first'))
                    return;
                if (id == 'first_send_request')
                    return;
                return etask.reject(Error('Network error'));
            });
            app = yield app_with_config({cli: {token: '123', dropin: true}});
            yield make_user_req(22225);
            yield make_user_req(22225);
            const failed = ['login', 'create_proxy_port_def',
                'send_request_successful'];
            perr_called_n_times_with('send_request', 1);
            // called 3 times due to logged_update and retry on mgr.start
            perr_called_n_times_with('login', 3);
            failed.slice(1).forEach(a=>perr_called_n_times_with(a, 2));
            assert.equal(app.manager.first_actions.pending.filter(
                d=>failed.includes(d.action)).length, failed.length);
        }));
        it('does not trigger send_request events on proxy status request',
        etask._fn(function*(_this){
            nock(api_base).get('/cp/lum_local_conf').query(true)
                .reply(200, {mock_result: true, _defaults: true});
            app = yield app_with_config({cli: {token: '123', dropin: true}});
            yield api('api/proxy_status/22225');
            sinon.assert.neverCalledWith(perr_stub, m('send_request'));
        }));
    });
    describe('should_resolve_proxy', ()=>{
        it('rotating, no max_requests', ()=>{
            const conf = {preset: 'rotating', max_requests: 0};
            assert.ok(!Manager.should_resolve_proxy(conf));
        });
        it('rotating 0', ()=>{
            const conf = {preset: 'rotating', max_requests: 0};
            assert.ok(!Manager.should_resolve_proxy(conf));
        });
        it('rotating 1', ()=>{
            const conf = {preset: 'rotating', max_requests: 1};
            assert.ok(!Manager.should_resolve_proxy(conf));
        });
        it('rotating 5', ()=>{
            const conf = {preset: 'rotating', max_requests: 5};
            assert.ok(Manager.should_resolve_proxy(conf));
        });
        it('long single session', ()=>{
            const conf = {preset: 'session_long'};
            assert.ok(Manager.should_resolve_proxy(conf));
        });
        it('long-availability', ()=>{
            const conf = {preset: 'long_availability'};
            assert.ok(Manager.should_resolve_proxy(conf));
        });
        it('sticky_ip', ()=>{
            const conf = {preset: 'sticky_ip'};
            assert.ok(Manager.should_resolve_proxy(conf));
        });
    });
});
