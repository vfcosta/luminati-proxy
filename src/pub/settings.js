// LICENSE_CODE ZON ISC
'use strict'; /*jslint react:true, es6:true*/
import Pure_component from '/www/util/pub/pure_component.js';
import React from 'react';
import {Labeled_controller, Nav, Loader_small} from './common.js';
import setdb from '../../util/setdb.js';
import ajax from '../../util/ajax.js';
import {ga_event} from './util.js';
import _ from 'lodash';
import {Select_zone, Pins} from './common/controls.js';

export default function Settings(){
    return <div className="settings">
          <Nav title="General settings"
            subtitle="Global configuration of Luminati Proxy Manager"/>
          <Form/>
        </div>;
}

const tooltips = {
    zone: `Default zone will be used automatically when creating a new
        port, if you don't specify any specific zone. This value can be
        overridden in each proxy port settings`,
    www_whitelist_ips: `List of IPs that are allowed to access web UI
        (including all API endpoints at http://localhost:22999/api) and
        make changes. can also include ranges of ips like so 0.0.0.0/0.
        Default value is 127.0.0.1, which means that remote access from
        any other IP is blocked unless list of IPs are added in this
        field.`,
    whitelist_ips: `Default access grant for all proxies. Only those
        IPs will be able to send requests to all proxies by default. Can
        be changed per proxy`,
    request_stats: `Enable saving statistics to database`,
    logs: `Specify how many requests you want to keep in database. The
        limit may be set as a number or maximum database size.`,
    log: `Decide how elaborate is the debugging information
        that you see in the console's log`,
};
for (let f in tooltips)
    tooltips[f] = tooltips[f].replace(/\s+/g, ' ').replace(/\n/g, ' ');

const log_level_opt = [
    {key: `Default (notice)`, value: ''},
    {key: `error`, value: 'error'},
    {key: `warn`, value: 'warn'},
    {key: `notice`, value: 'notice'},
    {key: `info`, value: 'info'},
];

class Form extends Pure_component {
    state = {saving: false};
    logs_metric_opts = [
        {key: 'requests', value: 'requests'},
        {key: 'megabytes', value: 'megabytes'},
    ];
    componentDidMount(){
        this.setdb_on('head.settings', settings=>{
            if (!settings||this.state.settings)
                return;
            this.setState({settings: {...settings}});
        });
        this.setdb_on('head.save_settings', save_settings=>{
            this.save_settings = save_settings;
            if (save_settings && this.resave)
            {
                delete this.resave;
                this.save();
            }
        });
    }
    zone_change = val=>{
        ga_event('settings', 'change_field', 'zone');
        this.setState(prev=>({settings: {...prev.settings, zone: val}}),
            this.debounced_save);
    };
    whitelist_ips_change = val=>{
        ga_event('settings', 'change_field', 'whitelist_ips');
        this.setState(
            ({settings})=>{
                const whitelist_ips = val.filter(
                    ip=>!settings.cmd_whitelist_ips.includes(ip));
                return {settings: {...settings, whitelist_ips}};
            },
            this.debounced_save);
    };
    www_whitelist_ips_change = val=>{
        ga_event('settings', 'change_field', 'www_whitelist_ips');
        this.setState(
            prev=>({settings: {...prev.settings, www_whitelist_ips: val}}),
            this.debounced_save);
    };
    logs_changed = val=>{
        this.setState(prev=>({settings: {...prev.settings, logs: +val}}),
            this.debounced_save);
    };
    log_changed = val=>{
        this.setState(prev=>({settings: {...prev.settings, log: val}}),
            this.debounced_save);
    };
    request_stats_changed = val=>{
        ga_event('settings', 'change_field', 'request_stats');
        this.setState(
            prev=>({settings: {...prev.settings, request_stats: val}}),
            this.debounced_save);
    };
    lock_nav = lock=>setdb.set('head.lock_navigation', lock);
    save = ()=>{
        if (this.saving || !this.save_settings)
        {
            this.resave = true;
            return;
        }
        ga_event('settings', 'save', 'start');
        this.lock_nav(true);
        this.setState({saving: true});
        this.saving = true;
        const _this = this;
        this.etask(function*(){
            this.on('uncaught', e=>{
                console.log(e);
                ga_event('settings', 'save', 'failed');
            });
            this.on('finally', ()=>{
                _this.setState({saving: false});
                _this.saving = false;
                _this.lock_nav(false);
                ga_event('settings', 'save', 'successful');
                if (_this.resave)
                {
                    delete _this.resave;
                    _this.save();
                }
            });
            const body = {..._this.state.settings};
            yield _this.save_settings(body);
            const zones = yield ajax.json({url: '/api/zones'});
            setdb.set('head.zones', zones);
        });
    };
    debounced_save = _.debounce(this.save, 500);
    render(){
        const s = this.state.settings;
        if (!s)
            return null;
        const wl = s.cmd_whitelist_ips.concat(s.whitelist_ips);
        return <div className="settings_form">
              <Labeled_controller label="Default zone" tooltip={tooltips.zone}>
                <Select_zone val={s.zone} preview
                  on_change_wrapper={this.zone_change}/>
              </Labeled_controller>
              <Labeled_controller label="Admin whitelisted IPs"
                tooltip={tooltips.www_whitelist_ips}>
                <Pins val={s.www_whitelist_ips} pending={s.pending_www_ips}
                  on_change_wrapper={this.www_whitelist_ips_change}/>
              </Labeled_controller>
              <Labeled_controller val={wl} disabled={s.cmd_whitelist_ips}
                type="pins" label="Proxy whitelisted IPs"
                on_change_wrapper={this.whitelist_ips_change}
                tooltip={tooltips.whitelist_ips}/>
              {false && <Labeled_controller val={s.log}
                type="select" data={log_level_opt}
                label="Log level" on_change_wrapper={this.log_changed}
                tooltip={tooltips.log}/>}
              <Labeled_controller val={s.request_stats}
                type="yes_no" on_change_wrapper={this.request_stats_changed}
                label="Enable recent stats" default
                tooltip={tooltips.request_stats}/>
              <Labeled_controller val={s.logs}
                type="select_number" on_change_wrapper={this.logs_changed}
                data={[0, 100, 1000, 10000]}
                label="Limit for request logs" default
                tooltip={tooltips.logs}/>
              <Loader_small show={this.state.saving}/>
            </div>;
    }
}
