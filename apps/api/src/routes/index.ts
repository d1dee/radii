import { Hono } from 'hono';
import type { AppVariables } from '../types';
import admin from './admin';
import hotspot from './hotspot';
import nas from './nas';
import payments from './payments';

const routes = new Hono<{ Variables: AppVariables }>();

routes.route('/admin', admin);
routes.route('/hotspot', hotspot);
routes.route('/nas', nas);
routes.route('/payments', payments);

export default routes;
