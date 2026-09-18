import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/charts/styles.css';

import { Center, Loader, MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { RequireAdmin } from '@/components/Auth/RequireAdmin';
import { AppLayout } from '@/components/Layout/AppLayout';
import { SettingsProvider } from '@/lib/settings';

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

export default function App() {
    return (
        <MantineProvider defaultColorScheme='auto'>
            <Notifications />
            <BrowserRouter>
                <Suspense
                    fallback={
                        <Center mih='100vh'>
                            <Loader />
                        </Center>
                    }
                >
                    <Routes>
                        {/* Admin auth flow — dedicated admin BetterAuth instance
                            (/api/admin/auth). Registration is open; email
                            verification via 2FA-style OTP is mandatory. */}
                        <Route path='/login' element={<LoginPage />} />
                        <Route path='/register' element={<RegisterPage />} />
                        <Route
                            path='/verify-email'
                            element={<VerifyEmailPage />}
                        />
                        <Route
                            path='/forgot-password'
                            element={<ForgotPasswordPage />}
                        />

                        {/* Everything else requires a verified admin session. */}
                        <Route
                            path='/*'
                            element={
                                <RequireAdmin>
                                    <SettingsProvider>
                                        <AppLayout>
                                            <Routes>
                                                <Route
                                                    path='/'
                                                    element={<DashboardPage />}
                                                />
                                                <Route
                                                    path='/users'
                                                    element={<UsersPage />}
                                                />
                                                <Route
                                                    path='/payments'
                                                    element={<PaymentsPage />}
                                                />
                                                <Route
                                                    path='/sessions'
                                                    element={<SessionsPage />}
                                                />
                                                <Route
                                                    path='/reports'
                                                    element={<ReportsPage />}
                                                />
                                                <Route
                                                    path='/packages'
                                                    element={<PackagesPage />}
                                                />
                                                <Route
                                                    path='/packages/add'
                                                    element={<PackageFormPage />}
                                                />
                                                <Route
                                                    path='/packages/:id/edit'
                                                    element={<PackageFormPage />}
                                                />
                                                <Route
                                                    path='/nas-devices'
                                                    element={<NasDevicesPage />}
                                                />
                                                <Route
                                                    path='/nas-devices/add'
                                                    element={<NasDeviceFormPage />}
                                                />
                                                <Route
                                                    path='/nas-devices/:id/edit'
                                                    element={<NasDeviceFormPage />}
                                                />
                                                <Route
                                                    path='/settings'
                                                    element={<SettingsPage />}
                                                />
                                            </Routes>
                                        </AppLayout>
                                    </SettingsProvider>
                                </RequireAdmin>
                            }
                        />
                    </Routes>
                </Suspense>
            </BrowserRouter>
        </MantineProvider>
    );
}
