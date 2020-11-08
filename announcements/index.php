<?php

// all variables
$pageCreator = "Alexandra French";
$pageCreationDate = "November 4, 2020";
$title = "Robotics Club Announcements and Events";
$currentWebmaster = "Alexandra French";
$updateDate = "November 4, 2020";
$pageDescription = "Robotics Club of Central Florida has regular site updates, workshops, socials, and project meetups.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, announcements, events, new events, september,
                               october, novemebr, CAD workshop, ROS workshop, officer nominations";
$url = "https://robotics.ucf.edu/announcements/index";
$markupImage = "https://robotics.ucf.edu/announcements/assets/imgs/2020-cad-workshop-1.jpg";

// header functions and include
include_once("../assets/templates/header.php");


// navbar
include_once("../assets/templates/navbar.php");

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
            <p> Here you can find all of our September 2020 events and news! We focused on workshops in September.
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

$description = "We have our officer nominations upcoming! Any dues paying member can nomination themselves to be an officer. Join us and help us decide who will run for our new officers next week.";
$announcement->generate("Officer Nominations", "assets/imgs/2020-cad-workshop-1.jpg", "cad drawing", $description, "November 2, 2020", "Alexandra French (Webmaster)", null, null);

$description = "We have an upcoming ROS/Gazebo workshop this week, November 6, at 6:30pm.<br>Join us to learn about Gazebo and ROS!";
$announcement->generate("ROS/Gazebo Workshop", "assets/imgs/gazebo-workshop.jpg", "Gazebo running bowser", $description, "November 2, 2020", "Alexandra French (Webmaster)", null, null);

$description = "Join us for Wacky Uncle Sal's Spooktacular Spookfest social, October 30, at 6:30pm. We'll be playing some Jackbox games and wearing our halloween costumes!";
$announcement->generate("Halloween Social", "assets/imgs/2020-halloween-pumpkin.jpg", "halloween pumpkin", $description, "October 28, 2020", "Alexandra French (Webmaster)", null, null);

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

?>
