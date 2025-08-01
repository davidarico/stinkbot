import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900">
      <div className="container mx-auto px-4 py-16">
        <div className="text-center mb-16">
          <h1 className="text-6xl font-bold text-white mb-6">Stinkwolf</h1>
          <p className="text-xl text-purple-200 mb-8">The Future of Werewolf Game Management</p>
        </div>

        <div className="text-center space-y-4">
          <div>
            <Link href="/roles">
              <Button
                variant="outline"
                size="lg"
                className="border-purple-400 text-purple-200 hover:bg-purple-800/50 px-8 py-3 text-lg bg-transparent"
              >
                View All Roles
              </Button>
            </Link>
          </div>
        </div>

        <div className="max-w-4xl mx-auto bg-white/10 backdrop-blur-lg rounded-lg p-8 mb-8">
          <h2 className="text-3xl font-bold text-white mb-6">Welcome to Stinky Solutions LLC</h2>
          <p className="text-lg text-purple-100 leading-relaxed mb-6">
            At Stinky Solutions LLC, we are revolutionizing the ancient art of Werewolf gameplay by bringing
            cutting-edge technology to your Discord server. Gone are the days of cumbersome Excel spreadsheets and
            manual role tracking that plague traditional game masters. Our sophisticated Stinkwolf bot represents the
            pinnacle of lycanthropic gaming innovation, seamlessly integrating with Discord's ecosystem to provide an
            unparalleled gaming experience.
          </p>
          <p className="text-lg text-purple-100 leading-relaxed mb-6">
            Our proprietary technology stack leverages advanced algorithms for role assignment, real-time vote tracking,
            and dynamic phase management. Whether you're managing a intimate village of 8 players or orchestrating chaos
            among 20+ participants, Stinkwolf's intelligent systems adapt to your game's unique requirements. The
            platform's intuitive interface eliminates the tedious administrative overhead that traditionally burdens
            game moderators, allowing them to focus on what truly matters: creating memorable moments of betrayal,
            deduction, and strategic gameplay.
          </p>
          <p className="text-lg text-purple-100 leading-relaxed">
            Join the thousands of Discord communities who have already embraced the future of social deduction gaming.
            With Stinkwolf, every game becomes a masterpiece of organized chaos, where technology meets tradition in
            perfect harmony.
          </p>
        </div>
      </div>
    </div>
  )
}
