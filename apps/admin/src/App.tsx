import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/charts/styles.css';

import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { RequireAdmin } from '@/components/Auth/RequireAdmin';
import { AppLayout } from '@/components/Layout/AppLayout';
import DashboardPage from '@/pages/DashboardPage';
import NasDeviceFormPage from '@/pages/NasDeviceFormPage';
import NasDevicesPage from '@/pages/NasDevicesPage';
import PackageFormPage from '@/pages/PackageFormPage';
import PackagesPage from '@/pages/PackagesPage';
import PaymentsPage from '@/pages/PaymentsPage';
import ReportsPage from '@/pages/ReportsPage';
import SessionsPage from '@/pages/SessionsPage';
import SettingsPage from '@/pages/SettingsPage';
import UsersPage from '@/pages/UsersPage';
import LoginPage from '@/pages/auth/LoginPage';
import RegisterPage from '@/pages/auth/RegisterPage';
import VerifyEmailPage from '@/pages/auth/VerifyEmailPage';
import { SettingsProvider } from '@/lib/settings';

export default function App() {
    return (
        <MantineProvider defaultColorScheme='auto'>
            <Notifications />
            <BrowserRouter>
                <Routes>
                    {/* Admin auth flow — dedicated admin BetterAuth instance
                        (/api/admin/auth). Registration is open; email
                        verification via 2FA-style OTP is mandatory. */}
                    <Route path='/login' element={<LoginPage />} />
                    <Route path='/register' element={<RegisterPage />} />
                    <Route path='/verify-email' element={<VerifyEmailPage />} />

                    {/* Everything else requires a verified admin session. */}
                    <Route
                        path='/*'
                        element={
                            <RequireAdmin>
                                <SettingsProvider>
                                    <AppLayout>
                                        <Routes>
                                            <Route path='/' element={<DashboardPage />} />
                                            <Route path='/users' element={<UsersPage />} />
                                            <Route path='/payments' element={<PaymentsPage />} />
                                            <Route path='/sessions' element={<SessionsPage />} />
                                            <Route path='/reports' element={<ReportsPage />} />
                                            <Route path='/packages' element={<PackagesPage />} />
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
            </BrowserRouter>
        </MantineProvider>
    );
}
