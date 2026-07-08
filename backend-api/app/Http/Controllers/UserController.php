<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\UploadsImages;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;

class UserController extends Controller
{
    use UploadsImages;

    private function requireAdmin(Request $request): void
    {
        abort_unless($request->user()->role === 'Admin', 403, 'Only Admins can manage users.');
    }

    public function index(Request $request)
    {
        $this->requireAdmin($request);

        $query = User::query();

        if ($request->filled('q')) {
            $search = $request->string('q');
            $query->where(function ($nested) use ($search) {
                $nested->where('name', 'like', "%{$search}%")
                    ->orWhere('email', 'like', "%{$search}%")
                    ->orWhere('phone', 'like', "%{$search}%");
            });
        }

        $query->when($request->filled('role'), fn ($q) => $q->where('role', $request->role));

        return $query->latest('id')->get();
    }

    public function store(Request $request)
    {
        $this->requireAdmin($request);

        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'unique:users,email'],
            'password' => ['required', 'string', 'min:8'],
            'role' => ['required', Rule::in(['Admin', 'Custodian', 'Maintenance Personnel'])],
            'phone' => ['nullable', 'string', 'max:30'],
            'address' => ['nullable', 'string', 'max:255'],
            'photo' => ['nullable', 'image', 'max:4096'],
        ]);

        $data['password'] = Hash::make($data['password']);
        $data['is_active'] = true;

        if ($request->hasFile('photo')) {
            $data['photo_url'] = $this->storeUploadedImage($request->file('photo'), 'profile-photos');
        }
        unset($data['photo']);

        $user = User::create($data);

        return response()->json($user, 201);
    }

    public function update(Request $request, User $user)
    {
        $this->requireAdmin($request);

        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'email' => ['sometimes', 'required', 'email', Rule::unique('users', 'email')->ignore($user->id)],
            'password' => ['nullable', 'string', 'min:8'],
            'role' => ['sometimes', 'required', Rule::in(['Admin', 'Custodian', 'Maintenance Personnel'])],
            'phone' => ['nullable', 'string', 'max:30'],
            'address' => ['nullable', 'string', 'max:255'],
            'photo' => ['nullable', 'image', 'max:4096'],
        ]);

        if (!empty($data['password'])) {
            $data['password'] = Hash::make($data['password']);
        } else {
            unset($data['password']);
        }

        if ($request->hasFile('photo')) {
            $data['photo_url'] = $this->storeUploadedImage($request->file('photo'), 'profile-photos');
        }
        unset($data['photo']);

        $user->update($data);

        return $user->fresh();
    }

    public function deactivate(Request $request, User $user)
    {
        $this->requireAdmin($request);
        abort_if($user->id === $request->user()->id, 422, 'You cannot deactivate your own account.');

        $user->update(['is_active' => false]);

        return response()->json(['message' => 'User deactivated.']);
    }

    public function activate(Request $request, User $user)
    {
        $this->requireAdmin($request);

        $user->update(['is_active' => true]);

        return response()->json(['message' => 'User activated.']);
    }
}
