import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/charts/styles.css';
import './admin.css';

import { Center, Loader, MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { lazy, Suspense } from 'react';
import {
    createBrowserRouter,
    createRoutesFromElements,
    Outlet,
    Route,
    RouterProvider,
} from 'react-router-dom';

import { RequireAdmin } from '@/components/Auth/RequireAdmin';
import { AppLayout } from '@/components/Layout/AppLayout';
import { SettingsProvider } from '@/lib/settings';
import { adminCssVariables, adminTheme } from './theme';

const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const NasDeviceFormPage = lazy(() => import('@/pages/NasDeviceFormPage'));
const NasDevicesPage = lazy(() => import('@/pages/NasDevicesPage'));
const PackageFormPage = lazy(() => import('@/pages/PackageFormPage'));
const PackagesPage = lazy(() => import('@/pages/PackagesPage'));
const PaymentsPage = lazy(() => import('@/pages/PaymentsPage'));
const ReportsPage = lazy(() => import('@/pages/ReportsPage'));
const SessionsPage = lazy(() => import('@/pages/SessionsPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const UsersPage = lazy(() => import('@/pages/UsersPage'));
const ForgotPasswordPage = lazy(
    () => import('@/pages/auth/ForgotPasswordPage'),
);
const LoginPage = lazy(() => import('@/pages/auth/LoginPage'));
const RegisterPage = lazy(() => import('@/pages/auth/RegisterPage'));
const VerifyEmailPage = lazy(() => import('@/pages/auth/VerifyEmailPage'));

const router = createBrowserRouter(
    createRoutesFromElements(
        <>
            {/* Auth pages remain outside the protected settings provider. */}
            <Route path='/login' element={<LoginPage />} />
            <Route path='/register' element={<RegisterPage />} />
            <Route path='/verify-email' element={<VerifyEmailPage />} />
            <Route path='/forgot-password' element={<ForgotPasswordPage />} />
            <Route
                path='/'
                element={
                    <RequireAdmin>
                        <SettingsProvider>
                            <AppLayout>
                                <Outlet />
                            </AppLayout>
                        </SettingsProvider>
                    </RequireAdmin>
                }
            >
                <Route index element={<DashboardPage />} />
                <Route path='users' element={<UsersPage />} />
                <Route path='payments' element={<PaymentsPage />} />
                <Route path='sessions' element={<SessionsPage />} />
                <Route path='reports' element={<ReportsPage />} />
                <Route path='packages' element={<PackagesPage />} />
                <Route path='packages/add' element={<PackageFormPage />} />
                <Route path='packages/:id/edit' element={<PackageFormPage />} />
                <Route path='nas-devices' element={<NasDevicesPage />} />
                <Route path='nas-devices/add' element={<NasDeviceFormPage />} />
                <Route
                    path='nas-devices/:id/edit'
                    element={<NasDeviceFormPage />}
                />
                <Route path='settings/*' element={<SettingsPage />} />
                <Route path='*' element={null} />
            </Route>
        </>,
    ),
);

export default function App() {
    return (
        <MantineProvider
            theme={adminTheme}
            cssVariablesResolver={adminCssVariables}
            defaultColorScheme='auto'
        >
            <Notifications />
            <Suspense
                fallback={
                    <Center mih='100vh'>
                        <Loader />
                    </Center>
                }
            >
                <RouterProvider router={router} />
            </Suspense>
        </MantineProvider>
    );
}
