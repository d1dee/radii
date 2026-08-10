import { Hono } from 'hono';
import type { AppVariables } from '../types';
import admin from './admin';
import hotspot from './hotspot';

const routes = new Hono<{ Variables: AppVariables }>();

routes.route('/admin', admin);
routes.route('/hotspot', hotspot);

export default routes;
