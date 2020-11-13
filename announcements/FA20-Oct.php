<?php

// header functions and include
include_once("../assets/templates/header.php");
$pageDescription = "In October, we had a Halloween social and many CAD and ROS workshops.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, announcements, events, october, october events,
                               halloween, october CAD workshop, get ROS, ROS, ROS workshop, pinewoood derby";
$headerGen = new Header("Alexandra French", "October 2, 2020", "Alexandra French", "November 12, 2020");
$headerGen->generateComment();
$headerGen->generateCommon("Robotics Club October Announcements", $pageDescription, $keywords, "https://robotics.ucf.edu/announcements/FA20-Oct");
$headerGen->generateCSS();
$headerGen->genWebsiteSEO("https://robotics.ucf.edu/announcements/FA20-Oct", "Robotics Club October Announcements", $pageDescription, "https://robotics.ucf.edu/announcements/assets/imgs/FA20-intro.jpg");
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
            <p> Here you can find all of our October 2020 events and news! We focused on socials and workshops in October.
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

$description = "Join us for Wacky Uncle Sal's Spooktacular Spookfest social, October 30, at 6:30pm. We'll be playing some Jackbox games and wearing our halloween costumes!";
$announcement->generate("Halloween Social", "assets/imgs/2020-halloween-pumpkin.jpg", "halloween pumpkin", $description, "October 28, 2020", "Alexandra French (Webmaster)", null, null);

$description = "We have an upcoming CAD workshop this week, October 28 at 6:30pm. Join us to learn more our pinewood derby competition and how to get started on your own pinewood derby car!";
$announcement->generate("Pinewood Derby CAD Workshop", "assets/imgs/2020-cad-workshop-1.jpg", "cad drawing for pinewood derby workshop", $description, "October 26, 2020", "Alexandra French (Webmaster)", null, null);

$description = "We have an upcoming 3D printing workshop this week, October 14, at 6:30pm. Join us to learn more about how to 3D print and create the designs for such! ";
$announcement->generate("3D Printing Workshop", "assets/imgs/2020-cad-workshop-1.jpg", "cad drawing", $description, "October 12, 2020", "Alexandra French (Webmaster)", null, null);

$description = "We have an upcoming ROS workshop this week, October 9, at 6:30pm. Join us to get a virtual machine on your PC, set it up, and install ubuntu on it. Afterwards, you'll learn some linux commands and then install ROS and get our Bowser simulator running!";
$announcement->generate("ROS Install Workshop", "assets/imgs/ros-install-workshop.jpg", "ROS", $description, "October 5, 2020", "Alexandra French (Webmaster)", null, null);

// adds bottom of page pagination
require_once("../assets/templates/pagination-bottom.php");
$pagination = new Pagination("FA20-Oct", "index", "FA20-Sep");
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
