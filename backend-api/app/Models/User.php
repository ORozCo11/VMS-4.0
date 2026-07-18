<?php

namespace App\Models;

use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Database\Eloquent\Factories\HasFactory;

// CHANGE THIS LINE to use Laravel's built-in token trait instead:
use Laravel\Sanctum\HasApiTokens; 

class User extends Authenticatable
{
    // Make sure it is included here inside the class wrapper:
    use HasApiTokens, Notifiable, HasFactory;

    /**
     * The attributes that are mass assignable.
     */
    protected $fillable = [
        'name',
        'email',
        'password',
        'role',
        'roles',
        'phone',
        'address',
        'photo_url',
        'is_active',
    ];

    /**
     * The attributes that should be hidden for serialization.
     */
    protected $hidden = [
        'password',
        'remember_token',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'roles'     => 'array',
    ];

    /**
     * Multi-role support. `role` remains the user's PRIMARY role (used for
     * routing, dashboards, badges); `roles` is the full set of hats the
     * account may wear (used for permission checks). One person in a small
     * barangay can hold, e.g., ['Custodian', 'Maintenance Personnel'] and act
     * under each — the action taken records which function they performed.
     */
    public function hasRole(string $role): bool
    {
        $roles = $this->roles;
        // Fall back to the primary role when the roles list isn't populated
        // (e.g. legacy rows or factory-made users created with only `role`).
        if (empty($roles)) {
            return $this->role === $role;
        }

        return in_array($role, $roles, true);
    }

    public function hasAnyRole(array $roles): bool
    {
        foreach ($roles as $role) {
            if ($this->hasRole($role)) {
                return true;
            }
        }

        return false;
    }

    /**
     * The account's effective role set — always includes the primary role.
     */
    public function allRoles(): array
    {
        $roles = $this->roles ?: [];
        if ($this->role && !in_array($this->role, $roles, true)) {
            $roles[] = $this->role;
        }

        return array_values(array_unique($roles));
    }

    /**
     * Match users who hold a given role either as their primary `role` or
     * anywhere in their `roles` list. Uses a portable LIKE against the JSON
     * text so it works identically on SQLite and Postgres (no JSON1 needed).
     */
    public function scopeHavingRole($query, string $role)
    {
        return $query->where(function ($q) use ($role) {
            $q->where('role', $role)
              ->orWhere('roles', 'like', '%"' . $role . '"%');
        });
    }
}