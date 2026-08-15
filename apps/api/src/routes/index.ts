import { Hono } from 'hono';
import type { AppVariables } from '../types';
import admin from './admin';
import hotspot from './hotspot';
import nas from './nas';

const routes = new Hono<{ Variables: AppVariables }>();

routes.route('/admin', admin);
routes.route('/hotspot', hotspot);
routes.route('/nas', nas);

export default routes;
