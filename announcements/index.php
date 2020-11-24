<?php

// header functions and include
include_once("../assets/templates/header.php");
$pageDescription = "Robotics Club of Central Florida has regular site updates, workshops, socials, and project meetups.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, announcements, events, new events, september,
                               october, novemebr, CAD workshop, ROS workshop, officer nominations";
$headerGen = new Header("Alexandra French", "August 5, 2020", "Alexandra French", "November 12, 2020");
$headerGen->generateComment();
$headerGen->generateCommon("Robotics Club Announcements and Events", $pageDescription, $keywords, "https://robotics.ucf.edu/announcements/index");
$headerGen->generateCSS();
$headerGen->genWebsiteSEO("https://robotics.ucf.edu/announcements/index", "Robotics Club Announcements and Events", $pageDescription, "https://robotics.ucf.edu/announcements/assets/imgs/2020-cad-workshop-1.jpg");
$headerGen->endHeader();


// navbar
include_once("../assets/templates/navbar.php");
$navbarGen = new Navbar(False);

?>

  <!-- Page Content -->
  <div class="container">

    <!-- announcements and events -->
    <div class="header-container-sm">
      <!-- title -->
      <h1 class="mt-4 mb-3 text-center p-2 title-blk-gold">Announcements and Events
      </h1>
      <!-- inner text -->
      <div class="container-wht-blk rounded p-3">
        <h2 class="text-center">Watching Our Progress? Getting Involved?</h2>
        <div class="row text-center">
          <div class="col-lg-12">
            <p> Here you can find all of our current 2020 events and news! We have been focusing on workshops, socials, and nominations/elections so far.
            </p>
          </div>
        </div>
      </div>
    </div>
    <!-- /.announcements -->
    
<?php

// all the announcements for this page
include_once('assets/templates/announcement.php');
$announcement = new Announcement();

$description = "Next week is Thanksgiving! With that also comes our yearly Thanksgiving social on Tuesday, November 24, at 6:30pm. Come join us to play some Jackbox games! We at the Robotics Club hope that everyone has a safe and fulfilling Thanksgiving this year.";
$announcement->generate("Thanksgiving Social", "../assets/imgs/placeholder-760x370.png", "placeholder club logo", $description, "November 22, 2020", "Alexandra French (Webmaster)");

$description = "Next week is officer elections! Any dues paying member can apply and vote during nominations. Join us and help us decide who will be our new officers Tuesday, November 17, at 6:30pm.";
$announcement->generate("Officer Elections", "../assets/imgs/placeholder-760x370.png", "placeholder robotics club logo", $description, "November 13, 2020", "Alexandra French (Webmaster)");

$description = "Next week is two workshops. Monday, November 16, at 6:30pm is 3D Printing with our guest presentor Fluvio Lobo. Learn more about 3D printing.! Friday, November 20, at 6:00pm is Intro to Computer vision. Learn how to track with OpenCv!";
$announcement->generate("Two Workshops next week!", "assets/imgs/2020-cad-workshop-1.jpg", "workshop image", $description, "November 12, 2020", "Alexandra French (Webmaster)");

$description = "Pinewood derby office hours, Q&A, and car work is coming up on Wednesday, November 11, at 6:30pm.Have you been working on a mini car to compete with? Need some help with a design? Have some other questions? Come join us on Discord!";
$announcement->generate("Pinewood Deby Office Hours", "../assets/imgs/placeholder-760x370.png", "robotics club logo", $description, "November 10, 2020", "Alexandra French (Webmaster)");

$description = "We have our officer nominations upcoming! Any dues paying member can nomination themselves to be an officer. Join us and help us decide who will run for our new officers Monday, November 9th, at 6:30pm.";
$announcement->generate("Officer Nominations", "assets/imgs/2020-cad-workshop-1.jpg", "cad drawing", $description, "November 2, 2020", "Alexandra French (Webmaster)", null, null);

$description = "Our upcoming ROS/Gazebo workshop will be rescheduled.<br>Join us to learn about Gazebo and ROS later on this semester!";
$announcement->generate("ROS/Gazebo Workshop", "assets/imgs/gazebo-workshop.jpg", "Gazebo running bowser", $description, "November 2, 2020", "Alexandra French (Webmaster)", null, null);

// add bottom of page pagination
require_once("../assets/templates/pagination-bottom.php");
$pagination = new Pagination("index", null, "FA20-Sep");
$pagination->generate(array("index", "FA20-Oct", "FA20-Sep", "FA20-Aug"), FALSE);

?>

  </div>
  <!-- /.container -->
  
<?php

// footer functions and include
include_once("../assets/templates/footer.php");
$footerGen = new Footer();
$footerGen->generateFooter();
$footerGen->generateJs();
$footerGen->endFile();

?>
