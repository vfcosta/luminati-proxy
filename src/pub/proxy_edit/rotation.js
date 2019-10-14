// LICENSE_CODE ZON ISC
'use strict'; /*jslint react:true, es6:true*/
import React from 'react';
import {Note} from '../common.js';
import {Config, Tab_context} from './common.js';
import Pure_component from '/www/util/pub/pure_component.js';
import $ from 'jquery';
import setdb from '../../../util/setdb.js';

const pool_type_opt = [
    {key: 'Default', value: ''},
    {key: 'Long Availability', value: 'long_availability'},
];

export default class Rotation extends Pure_component {
    state = {};
    goto_field = setdb.get('head.proxy_edit.goto_field');
    set_field = setdb.get('head.proxy_edit.set_field');
    get_curr_plan = setdb.get('head.proxy_edit.get_curr_plan');
    componentDidMount(){
        this.setdb_on('head.proxy_edit.disabled_fields', disabled_fields=>{
            disabled_fields && this.setState({disabled_fields});
        });
        this.setdb_on('head.proxy_edit.form', form=>{
            form && this.setState({form});
        });
    }
    get_type = ()=>{
        // XXX krzysztof: cleanup type (index.js rotation.js general.js)
        const curr_plan = this.get_curr_plan();
        let type;
        if (curr_plan && (curr_plan.type||'').startsWith('static'))
            type = 'ips';
        else if (curr_plan&&!!curr_plan.vip)
            type = 'vips';
        return type;
    };
    open_modal = ()=>$('#allocated_ips').modal('show');
    move_to_ssl = ()=>this.goto_field('ssl');
    is_long_availability = pool_type=>{
        pool_type = pool_type || this.state.form.pool_type;
        return !pool_type || pool_type=='long_availability';
    };
    render(){
        if (!this.state.disabled_fields)
            return null;
        const form = this.state.form;
        if (!form)
            return null;
        const type = this.get_type();
        const render_modal = ['ips', 'vips'].includes(type);
        let pool_size_note;
        if (!this.state.disabled_fields.pool_size && render_modal)
        {
            pool_size_note =
                <a className="link" onClick={this.open_modal}>
                  {'manage '+(type=='ips' ? 'IPs' : 'gIPs')}
                </a>;
        }
        const sess_note =
            <Note>
              <span>Should be used only when </span>
              <a className="link" onClick={this.move_to_ssl}>SSL analyzing</a>
              <span> is turned on.</span>
            </Note>;
        const pool_size_disabled = form.ips.length||form.vips.length;
        return <div className="rotation">
              <Tab_context.Provider value="rotation">
                <Config type="select" id="pool_type" data={pool_type_opt}/>
                <Config type="select_number" id="pool_size"
                  note={pool_size_note} disabled={pool_size_disabled}/>
                <Config type="yes_no" id="idle_pool"/>
                <Config type="yes_no" id="pool_prefill"/>
                <Config type="select_number" id="max_requests"/>
                <Config type="select_number" id="session_duration"
                  sufix="seconds"/>
                <Config type="yes_no" id="sticky_ip"/>
                <Config type="yes_no" id="session_random"/>
                {!form.session_random && <Config type="text" id="session"/>}
                <Config type="text" id="seed"/>
                <Config type="yes_no" id="session_termination"
                  note={sess_note}/>
              </Tab_context.Provider>
            </div>;
    }
}

