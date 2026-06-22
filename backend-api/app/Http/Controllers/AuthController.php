<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\ActivityLog;
use App\Models\User;
use Illuminate\Support\Facades\Hash;

class AuthController extends Controller
{
    /**
     * Handle stateless frontend login requests.
     */
    public function login(Request $request)
    {
        // 1. Validate incoming user inputs from React
        $request->validate([
            'email' => 'required|email',
            'password' => 'required|string',
        ]);

        // 2. Locate the user profile row in the database
        $user = User::where('email', $request->email)->first();

        // 3. Verify the record exists and evaluate the encrypted password match
        if (!$user || !Hash::check($request->password, $user->password)) {
            return response()->json([
                'message' => 'Invalid credentials provided. Please check your email or password.'
            ], 401); // Returns 401 Unauthorized status code
        }

        // 4. Issue a secure, unique Sanctum token string and tag it with the user's system role
        $token = $user->createToken('auth_token', [$user->role])->plainTextToken;

        // 5. Send data bundle back to the React client application
        return response()->json([
            'message' => 'Login authenticated successfully!',
            'access_token' => $token,
            'token_type' => 'Bearer',
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'role' => $user->role // Shared so React can trigger the correct portal layout views
            ]
        ], 200);
    }

    /**
     * Terminate active sessions and revoke active tokens.
     */
    public function logout(Request $request)
    {
        // Revoke the exact token string utilized to authenticate the active API request
        $request->user()->currentAccessToken()->delete();

        return response()->json([
            'message' => 'Session terminated and token revoked successfully.'
        ], 200);
    }

    /**
     * Return a time-aware greeting for the authenticated workspace user.
     */
    public function greeting(Request $request)
    {
        $user = $request->user();
        $timezone = 'Asia/Manila';
        $now = now($timezone);
        $hour = (int) $now->format('G');
        $displayName = strtoupper(strtok(trim($user->name), ' ') ?: $user->name);

        $period = match (true) {
            $hour >= 5 && $hour < 12 => 'morning',
            $hour === 12 => 'noon',
            $hour >= 13 && $hour < 15 => 'afternoon',
            $hour >= 15 && $hour < 18 => 'late_afternoon',
            $hour >= 18 && $hour < 22 => 'evening',
            default => 'night',
        };

        $messages = [
            'morning' => [
                "Rise and shine, {$displayName}!",
                "A bright morning to you, {$displayName}!",
                "Fresh start, {$displayName}! Let's keep the fleet moving.",
                "Morning momentum is here, {$displayName}!",
            ],
            'noon' => [
                "Happy noon, {$displayName}!",
                "Midday check-in, {$displayName}! The fleet is ready.",
                "It's noon, {$displayName}! Keep the day rolling.",
                "A steady noon to you, {$displayName}!",
            ],
            'afternoon' => [
                "A pleasant afternoon, {$displayName}!",
                "Good energy this afternoon, {$displayName}!",
                "Afternoon focus is on, {$displayName}!",
                "Keep the dashboard sharp this afternoon, {$displayName}!",
            ],
            'late_afternoon' => [
                "It's late afternoon, {$displayName}!",
                "Late afternoon focus, {$displayName}!",
                "A strong late afternoon to you, {$displayName}!",
                "The day is still moving, {$displayName}!",
            ],
            'evening' => [
                "A calm evening to you, {$displayName}!",
                "Evening check-in, {$displayName}! The fleet is in view.",
                "Good evening, {$displayName}! Keep things steady.",
                "The evening shift is looking sharp, {$displayName}!",
            ],
            'night' => [
                "Working late, {$displayName}? The dashboard is ready.",
                "Quiet night watch, {$displayName}!",
                "Late-night focus, {$displayName}!",
                "The fleet rests easier with you here, {$displayName}!",
            ],
        ];

        $roleLabel = match ($user->role) {
            'Admin' => 'Administrator',
            'Maintenance Personnel' => 'Maintenance',
            default => $user->role,
        };

        $periodMessages = $messages[$period];
        $greeting = $periodMessages[random_int(0, count($periodMessages) - 1)];

        return response()->json([
            'greeting' => $greeting,
            'period' => $period,
            'role_label' => $roleLabel,
            'timezone' => $timezone,
            'generated_at' => $now->toIso8601String(),
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'role' => $user->role,
            ],
        ]);
    }

    /**
     * Update the authenticated user's security password.
     */
    public function updatePassword(Request $request)
    {
        $data = $request->validate([
            'old_password' => ['required', 'string'],
            'new_password' => ['required', 'string', 'min:8', 'confirmed'],
        ]);

        if (! Hash::check($data['old_password'], $request->user()->password)) {
            return response()->json([
                'message' => 'The old password you entered is incorrect.',
            ], 422);
        }

        $request->user()->update([
            'password' => Hash::make($data['new_password']),
        ]);

        ActivityLog::create([
            'user_id' => $request->user()->id,
            'role' => $request->user()->role,
            'action' => 'Edit',
            'module' => 'Profile',
            'affected_record_id' => (string) $request->user()->id,
            'details' => "{$request->user()->name} updated account security credentials.",
        ]);

        return response()->json([
            'message' => 'Password updated successfully.',
        ]);
    }
}
