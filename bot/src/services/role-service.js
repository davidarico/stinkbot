class RoleService {
    /**
     * Assign a role to a guild member
     */
    async assignRole(member, roleName) {
        try {
            const role = member.guild.roles.cache.find(r => r.name === roleName);
            if (role && !member.roles.cache.has(role.id)) {
                await member.roles.add(role);
                console.log(`Assigned role "${roleName}" to ${member.displayName}`);
            }
        } catch (error) {
            console.error(`Error assigning role "${roleName}":`, error);
        }
    }

    /**
     * Remove a role from a guild member
     * @returns {boolean} True if role was removed, false otherwise
     */
    async removeRole(member, roleName) {
        try {
            const role = member.guild.roles.cache.find(r => r.name === roleName);
            if (role && member.roles.cache.has(role.id)) {
                await member.roles.remove(role);
                console.log(`Removed role "${roleName}" from ${member.displayName}`);
                // For killPlayer to determine if player was actually alive
                return true;
            }
        } catch (error) {
            console.error(`Error removing role "${roleName}":`, error);
        }
        return false;
    }

    /**
     * Assign spectator role and remove all game roles
     */
    async assignSpectatorRole(member) {
        // Remove all game roles and assign spectator
        await this.removeRole(member, 'Signed Up');
        await this.removeRole(member, 'Alive');
        await this.removeRole(member, 'Dead');
        await this.assignRole(member, 'Spectator');
    }
}

module.exports = RoleService;
